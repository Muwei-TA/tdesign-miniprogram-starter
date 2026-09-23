import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// api/transport.js 是小程序 ES module；这里用 Node 内置 vm 加载实际源码，避免复制一份映射逻辑。
const source = readFileSync(join(ROOT, 'api/transport.js'), 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const module = { exports: {} };
vm.runInNewContext(
  `${source}\nmodule.exports = { resolveTransport, withIdempotency };`,
  { module, exports: module.exports, decodeURIComponent, encodeURIComponent },
);

const { resolveTransport, withIdempotency } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(resolveTransport('/posts?cursor=c1&type=article', 'GET', {})), {
  action: 'posts/list',
  payload: { cursor: 'c1', type: 'article' },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1', 'GET', {})), {
  action: 'posts/detail',
  payload: { id: 'p-1' },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/reaction', 'DELETE', {})), {
  action: 'posts/reaction',
  payload: { id: 'p-1', next: false },
});
assert.deepEqual(plain(resolveTransport('/assets/a-1', 'GET', {})), {
  action: 'assets/status',
  payload: { assetId: 'a-1' },
});
assert.deepEqual(plain(resolveTransport('/assets/upload', 'POST', {
  assetId: 'a-1',
  contentBase64: 'iVBORw0KGgo=',
  idempotencyKey: 'asset-upload-1',
})), {
  action: 'assets/upload',
  payload: {
    assetId: 'a-1',
    contentBase64: 'iVBORw0KGgo=',
    idempotencyKey: 'asset-upload-1',
  },
});
assert.deepEqual(plain(resolveTransport('/assets/confirm', 'POST', { assetId: 'a-1' })), {
  action: 'assets/confirm',
  payload: { assetId: 'a-1' },
});
assert.deepEqual(plain(resolveTransport('/me/contents?tab=topics&cursor=c2', 'GET', {})), {
  action: 'me/topics',
  payload: { cursor: 'c2' },
});
assert.deepEqual(plain(resolveTransport('/session/wechat', 'POST', { code: 'ignored' })), {
  action: 'session/me',
  payload: {},
});
assert.deepEqual(plain(resolveTransport('/admin/usage/status', 'GET', {})), {
  action: 'admin/usage/status',
  payload: {},
});

const first = withIdempotency({ body: 'draft' }, 'post-key-1');
const retry = withIdempotency(first, 'post-key-1');
assert.deepEqual(plain(first), { body: 'draft', idempotencyKey: 'post-key-1' });
assert.deepEqual(plain(retry), plain(first));

assert.throws(() => resolveTransport('/unknown', 'GET', {}), /Unsupported API endpoint/);

const requestSource = readFileSync(join(ROOT, 'api/request.js'), 'utf8');
const appSource = readFileSync(join(ROOT, 'app.js'), 'utf8');
const configSource = readFileSync(join(ROOT, 'config.js'), 'utf8');
assert.match(appSource, /wx\.cloud\.init/);
assert.match(appSource, /env:\s*config\.env/);
assert.match(configSource, /isMock:\s*false/);
assert.match(requestSource, /wx\.cloud\.callFunction/);
assert.doesNotMatch(requestSource, /Bearer|SESSION_TOKEN_KEY|Idempotency-Key/);

// 加载实际 request.js（去掉小程序 alias import），验证真实/Mock 分支的运行行为。
const requestModule = { exports: {} };
const runtimeConfig = { isMock: false, baseUrl: '', cloudFunctionName: 'api' };
const runtime = {
  module: requestModule,
  exports: requestModule.exports,
  __config: runtimeConfig,
  resolveTransport,
  withIdempotency,
  wx: { cloud: {} },
  setTimeout,
  clearTimeout,
};
const requestSourceForNode = requestSource
  .replace("import config from '~/config';", 'const config = __config;')
  .replace("import { resolveTransport, withIdempotency } from '~/api/transport';", '')
  .replace(/export class /g, 'class ')
  .replace('export default function request', 'function request')
  .replace(/export function /g, 'function ')
  .replace('export { DEFAULT_MESSAGE };', '')
  .concat('\nmodule.exports = { request, ApiError };');
vm.runInNewContext(requestSourceForNode, runtime);

const request = requestModule.exports.request;
const cloudCalls = [];
runtime.wx.cloud.callFunction = ({ name, data }) => {
  cloudCalls.push({ name, data });
  return Promise.resolve({ result: { code: 0, message: 'ok', data: { accepted: true } } });
};
assert.deepEqual(
  plain(await request('/posts', { method: 'POST', data: { body: 'draft' }, idempotencyKey: 'post-key-2' })),
  { accepted: true },
);
assert.deepEqual(plain(cloudCalls[0]), {
  name: 'api',
  data: { action: 'posts/create', payload: { body: 'draft', idempotencyKey: 'post-key-2' } },
});
await request('/session/me');
await request('/posts?cursor=next-page');
assert.equal(cloudCalls[1].data.action, 'session/me');
assert.deepEqual(plain(cloudCalls[2].data), {
  action: 'posts/list',
  payload: { cursor: 'next-page' },
});

runtime.wx.cloud.callFunction = () => Promise.resolve({
  result: { code: 'not_accessible', message: '内部差异不应暴露' },
});
await assert.rejects(request('/posts/hidden'), (error) => {
  assert.equal(error.kind, 'not_accessible');
  assert.equal(error.message, '这条内容当前不可访问');
  return true;
});

runtime.wx.cloud.callFunction = () => new Promise(() => {});
await assert.rejects(request('/session/me', { timeout: 1 }), (error) => {
  assert.equal(error.kind, 'timeout');
  return true;
});

runtimeConfig.isMock = true;
let mockRequest;
runtime.wx.request = (options) => {
  mockRequest = options;
  options.success({ statusCode: 200, data: { code: 0, message: 'ok', data: { mocked: true } } });
};
assert.deepEqual(
  plain(await request('/posts', { method: 'POST', data: { body: 'mock' }, idempotencyKey: 'post-key-3' })),
  { mocked: true },
);
assert.equal(mockRequest.data.idempotencyKey, 'post-key-3');
assert.equal(mockRequest.header.Authorization, undefined);

console.log('OK: transport mapping, native auth boundary, and idempotency payload checks passed');
