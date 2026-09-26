import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const FRONT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = process.env.BLACKLIGHT_BACKEND_WORKTREE
  || resolve(FRONT_ROOT, '../blacklight-development');
const BACKEND_HELPER = join(BACKEND_ROOT, 'tests/support/local-api.mjs');
const hasBackendHelper = existsSync(BACKEND_HELPER);
if (process.env.BLACKLIGHT_BACKEND_WORKTREE && !hasBackendHelper) {
  throw new Error(`BLACKLIGHT_BACKEND_WORKTREE has no tests/support/local-api.mjs: ${BACKEND_ROOT}`);
}
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadTransport() {
  const source = readFileSync(join(FRONT_ROOT, 'api/transport.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  const module = { exports: {} };
  vm.runInNewContext(`${source}\nmodule.exports = { resolveTransport, withIdempotency };`, {
    module,
    exports: module.exports,
    decodeURIComponent,
    encodeURIComponent,
  });
  return module.exports;
}

function loadEndpoints() {
  const source = readFileSync(join(FRONT_ROOT, 'api/endpoints.js'), 'utf8')
    .replace('export default', 'module.exports =');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports });
  return module.exports;
}

function loadRequest(callFunction, app = { invalidateSession() {} }) {
  const source = readFileSync(join(FRONT_ROOT, 'api/request.js'), 'utf8')
    .replace("import config from '~/config';", 'const config = __config;')
    .replace(
      "import { resolveTransport, withIdempotency } from '~/api/transport';",
      'const { resolveTransport, withIdempotency } = __transport;',
    )
    .replace(/export class /g, 'class ')
    .replace('export default function request', 'function request')
    .replace(/export function /g, 'function ')
    .replace('export { DEFAULT_MESSAGE };', '')
    .concat('\nmodule.exports = { request, ApiError, withPath, withQuery };');
  const module = { exports: {} };
  const runtime = {
    module,
    exports: module.exports,
    __config: { cloudFunctionName: 'api' },
    __transport: loadTransport(),
    wx: { cloud: { callFunction } },
    getApp: () => app,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, runtime);
  return module.exports;
}

function loadPostsService(requestModule) {
  const source = readFileSync(join(FRONT_ROOT, 'services/posts.js'), 'utf8')
    .replace(
      "import request, { withPath, withQuery } from '~/api/request';",
      'const { request, withPath, withQuery } = __request;',
    )
    .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
    .replace(
      "import { createIdempotencyKey } from '~/utils/idempotency';",
      'const createIdempotencyKey = __createIdempotencyKey;',
    )
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace('export default {', 'module.exports = {');
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    __request: requestModule,
    __endpoints: loadEndpoints(),
    __createIdempotencyKey: () => 'integration-comment-key',
  });
  return module.exports;
}

test('actual request.js and posts service reach local API handlers for comment list, reaction, delete and conflict', {
  skip: hasBackendHelper ? false : 'Set BLACKLIGHT_BACKEND_WORKTREE to a backend checkout with tests/support/local-api.mjs',
}, async () => {
  const { createCommentMemoryDatabase, createLocalApiHarness } = await import(pathToFileURL(BACKEND_HELPER).href);
  const db = createCommentMemoryDatabase();
  const member1 = createLocalApiHarness({ db, openid: 'openid-member-1' });
  const member2 = createLocalApiHarness({ db, openid: 'openid-member-2' });
  try {
    const calls = [];
    const localCall = (local) => async (options) => {
      calls.push(plain(options));
      return local.callFunction(options);
    };
    const member1Posts = loadPostsService(loadRequest(localCall(member1)));
    const member2Posts = loadPostsService(loadRequest(localCall(member2)));

    const ownComments = await member1Posts.fetchComments('post-1');
    assert.equal(ownComments.items.find((item) => item.id === 'c1').viewer.canDelete, true);
    assert.equal(ownComments.items.find((item) => item.id === 'c4').status, 'pending');
    const otherComments = await member2Posts.fetchComments('post-1');
    assert.equal(otherComments.items.some((item) => item.id === 'c4'), false);

    const reaction = await member2Posts.toggleCommentReaction('post-1', 'c1', true);
    assert.deepEqual(plain(reaction), { ok: true, reacted: true, count: 1 });
    const reacted = await member2Posts.fetchComments('post-1');
    assert.equal(reacted.items.find((item) => item.id === 'c1').viewer.reacted, true);
    assert.equal(reacted.items.find((item) => item.id === 'c1').counters.reactions, 1);

    await assert.rejects(member2Posts.deleteComment('post-1', 'c1', 1), (error) => error.kind === 'forbidden');
    await assert.rejects(member1Posts.deleteComment('post-1', 'c1', 9), (error) => error.kind === 'conflict');
    assert.deepEqual(plain(await member1Posts.deleteComment('post-1', 'c1', 1)), { ok: true });

    const afterDelete = await member2Posts.fetchComments('post-1');
    const tombstone = afterDelete.items.find((item) => item.id === 'c1');
    assert.equal(tombstone.deleted, true);
    assert.equal(tombstone.body, '这条回应已被删除。');
    assert.equal(tombstone.author.userId, null);
    assert.equal(tombstone.counters.reactions, 0);
    assert.equal(tombstone.replies.some((reply) => reply.id === 'c2'), true);
    assert.deepEqual(calls.map((call) => call.data.action), [
      'posts/comments/list',
      'posts/comments/list',
      'posts/comments/reaction',
      'posts/comments/list',
      'posts/comments/delete',
      'posts/comments/delete',
      'posts/comments/delete',
      'posts/comments/list',
    ]);
    assert.deepEqual(calls[2].data.payload, { id: 'post-1', commentId: 'c1', next: true });
    assert.deepEqual(calls[5].data.payload, { id: 'post-1', commentId: 'c1', expectedVersion: 9 });
  } finally {
    member1.dispose();
    member2.dispose();
  }
});
