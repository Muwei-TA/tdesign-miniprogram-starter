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
assert.deepEqual(plain(resolveTransport('/posts?boardId=b-1&cursor=c2', 'GET', {})), {
  action: 'posts/list',
  payload: { boardId: 'b-1', cursor: 'c2' },
});
assert.deepEqual(plain(resolveTransport('/boards?q=reading&cursor=c1&status=active', 'GET', {})), {
  action: 'boards/list',
  payload: { q: 'reading', cursor: 'c1', status: 'active' },
});
assert.deepEqual(plain(resolveTransport('/boards', 'POST', { title: 'Reading', description: 'Books together' })), {
  action: 'boards/create',
  payload: { title: 'Reading', description: 'Books together' },
});
assert.deepEqual(plain(resolveTransport('/boards/board-1?cursor=c2', 'GET', {})), {
  action: 'boards/detail',
  payload: { id: 'board-1', cursor: 'c2' },
});
assert.deepEqual(plain(resolveTransport('/admin/queues/board?cursor=c3', 'GET', {})), {
  action: 'admin/queue',
  payload: { cursor: 'c3', queue: 'board' },
});
assert.deepEqual(plain(resolveTransport('/admin/boards/board-1/decision', 'POST', {
  decision: 'approve', reason: 'clear scope', expectedVersion: 2,
})), {
  action: 'admin/board/decide',
  payload: { decision: 'approve', reason: 'clear scope', expectedVersion: 2, id: 'board-1' },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1', 'GET', {})), {
  action: 'posts/detail',
  payload: { id: 'p-1' },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/resubmit', 'PATCH', {
  title: 'revised', body: 'new text', expectedVersion: 2, idempotencyKey: 'retry-1',
})), {
  action: 'posts/resubmit',
  payload: { id: 'p-1', title: 'revised', body: 'new text', expectedVersion: 2, idempotencyKey: 'retry-1' },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/reaction', 'DELETE', {})), {
  action: 'posts/reaction',
  payload: { id: 'p-1', next: false },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/comments/c-9/reaction', 'PUT', {})), {
  action: 'posts/comments/reaction',
  payload: { id: 'p-1', commentId: 'c-9', next: true },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/comments/c-9/reaction', 'DELETE', {})), {
  action: 'posts/comments/reaction',
  payload: { id: 'p-1', commentId: 'c-9', next: false },
});
assert.deepEqual(plain(resolveTransport('/posts/p-1/comments/c-9', 'DELETE', { expectedVersion: 3 })), {
  action: 'posts/comments/delete',
  payload: { id: 'p-1', commentId: 'c-9', expectedVersion: 3 },
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
assert.deepEqual(plain(resolveTransport('/clubs', 'GET')), { action: 'clubs/list', payload: {} });
assert.deepEqual(plain(resolveTransport('/clubs/mine', 'GET')), { action: 'clubs/mine', payload: {} });
assert.deepEqual(plain(resolveTransport('/clubs/club-b', 'GET')), {
  action: 'clubs/detail',
  payload: { id: 'club-b' },
});
assert.deepEqual(plain(resolveTransport('/account/me', 'GET')), { action: 'account/me', payload: {} });
assert.deepEqual(plain(resolveTransport('/me/levels', 'GET', {})), {
  action: 'me/levels',
  payload: {},
});
assert.deepEqual(plain(resolveTransport('/me/check-in', 'POST', {})), {
  action: 'me/check-in',
  payload: {},
});
assert.deepEqual(plain(resolveTransport('/admin/usage/status', 'GET', {})), {
  action: 'admin/usage/status',
  payload: {},
});
assert.deepEqual(plain(resolveTransport('/account/web-login/info', 'POST', { id: 'pair-12345678' })), {
  action: 'account/web-login/info',
  payload: { id: 'pair-12345678' },
});
assert.deepEqual(plain(resolveTransport('/account/handovers', 'GET', {})), {
  action: 'account/handovers/list',
  payload: {},
});
assert.deepEqual(plain(resolveTransport('/account/recovery/r-1', 'GET', {})), {
  action: 'account/recovery/info',
  payload: { recoveryId: 'r-1' },
});
assert.deepEqual(plain(resolveTransport('/account/recovery/accept', 'POST', { recoveryId: 'r-1', expectedVersion: 3 })), {
  action: 'account/recovery/accept',
  payload: { recoveryId: 'r-1', expectedVersion: 3 },
});
assert.deepEqual(plain(resolveTransport('/admin/invites?limit=20&cursor=c1&status=active', 'GET', {})), {
  action: 'admin/invites/list',
  payload: { limit: '20', cursor: 'c1', status: 'active' },
});
assert.deepEqual(plain(resolveTransport('/admin/invites/i-1/revoke', 'POST', { expectedVersion: 2, reason: '不再招新' })), {
  action: 'admin/invites/revoke',
  payload: { expectedVersion: 2, reason: '不再招新', inviteId: 'i-1' },
});
assert.deepEqual(plain(resolveTransport('/membership/applications/a-1/cancel', 'POST', { expectedVersion: 4, reason: '本人撤回' })), {
  action: 'membership/cancel',
  payload: { expectedVersion: 4, reason: '本人撤回', applicationId: 'a-1' },
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
assert.match(appSource, /config\.transport !== 'cloudbase'/);
assert.match(configSource, /activeProfile = 'nasProduction'/);
assert.match(configSource, /nasLanDevelopment:[\s\S]*apiBaseUrl: 'http:\/\/192\.168\.50\.28:18118'/);
assert.match(configSource, /nasLocalDevelopment:[\s\S]*apiBaseUrl: 'http:\/\/127\.0\.0\.1:18884'/);
assert.match(configSource, /nasProduction:[\s\S]*apiBaseUrl: 'https:\/\/api\.muwei\.xyz'/);
assert.match(requestSource, /profile === 'nasLocalDevelopment'/);
assert.match(requestSource, /wx\.cloud\.callFunction/);
assert.match(requestSource, /wx\.request/);
assert.match(requestSource, /Authorization: `Bearer \$\{token\}`/);
assert.doesNotMatch(requestSource, /SESSION_TOKEN_KEY|Idempotency-Key/);

// 加载实际 request.js（去掉小程序 alias import），验证 CloudBase 请求的运行行为。
const requestModule = { exports: {} };
const runtimeConfig = { transport: 'cloudbase', cloudFunctionName: 'api' };
const cloudApp = { globalData: { session: { club: { id: 'club-a' } }, clubContextVersion: 0, clubSwitching: false } };
const runtime = {
  module: requestModule,
  exports: requestModule.exports,
  __config: runtimeConfig,
  resolveTransport,
  withIdempotency,
  wx: { cloud: {} },
  getApp: () => cloudApp,
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
  .concat('\nmodule.exports = { request, ApiError, clearAuthToken };');
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
  data: { action: 'posts/create', payload: { body: 'draft', idempotencyKey: 'post-key-2' }, clubId: 'club-a' },
});
await request('/session/me');
await request('/posts?cursor=next-page');
assert.equal(cloudCalls[1].data.action, 'session/me');
assert.equal(cloudCalls[1].data.clubId, 'club-a');
assert.deepEqual(plain(cloudCalls[2].data), {
  action: 'posts/list',
  payload: { cursor: 'next-page' },
  clubId: 'club-a',
});
await request('/clubs');
assert.deepEqual(plain(cloudCalls[3].data), { action: 'clubs/list', payload: {} });
await request('/account/me');
assert.deepEqual(plain(cloudCalls[4].data), { action: 'account/me', payload: {} });

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

// Load the same request implementation with the isolated NAS LAN profile.
const nasModule = { exports: {} };
let invalidations = 0;
const nasApp = {
  globalData: { session: { club: { id: 'club-a' } }, clubContextVersion: 0, clubSwitching: false },
  invalidateSession() { invalidations += 1; },
  invalidateClubSelection() { invalidations += 1; },
};
const nasRuntime = {
  module: nasModule,
  exports: nasModule.exports,
  __config: {
    transport: 'nas',
    profile: 'nasLanDevelopment',
    apiBaseUrl: 'http://192.168.50.28:18118',
  },
  resolveTransport,
  withIdempotency,
  wx: { cloud: {} },
  setTimeout,
  clearTimeout,
  getApp: () => nasApp,
};
vm.runInNewContext(requestSourceForNode, nasRuntime);

const nasRequest = nasModule.exports.request;
const httpCalls = [];
let loginCount = 0;
const queuedResponses = [];
nasRuntime.wx.login = ({ success }) => {
  loginCount += 1;
  success({ code: `login-code-${loginCount}` });
};
nasRuntime.wx.request = (options) => {
  httpCalls.push(options);
  if (options.url.endsWith('/v1/auth/wechat')) {
    options.success({
      statusCode: 200,
      data: { code: 0, data: { token: `nas-token-${loginCount}` } },
    });
    return {};
  }
  const response = queuedResponses.shift() || {
    statusCode: 200,
    data: { code: 0, data: { accepted: true } },
  };
  options.success(response);
  return {};
};

assert.deepEqual(
  plain(await nasRequest('/posts', {
    method: 'POST',
    data: { body: 'draft' },
    idempotencyKey: 'nas-post-key',
  })),
  { accepted: true },
);
assert.equal(loginCount, 1);
assert.equal(httpCalls.length, 2);
assert.equal(httpCalls[0].url, 'http://192.168.50.28:18118/v1/auth/wechat');
assert.deepEqual(plain(httpCalls[0].data), { code: 'login-code-1' });
assert.equal(httpCalls[0].header.Authorization, undefined);
assert.equal(httpCalls[1].url, 'http://192.168.50.28:18118/v1/action');
assert.equal(httpCalls[1].header.Authorization, 'Bearer nas-token-1');
assert.deepEqual(plain(httpCalls[1].data), {
  action: 'posts/create',
  payload: { body: 'draft', idempotencyKey: 'nas-post-key' },
  clubId: 'club-a',
});

await nasRequest('/boards?cursor=c1');
assert.equal(loginCount, 1, 'a live in-memory token is reused');
assert.equal(httpCalls[2].data.action, 'boards/list');
assert.equal(httpCalls[2].data.clubId, 'club-a');

queuedResponses.push({
  statusCode: 401,
  data: { code: 'unauthenticated', message: 'expired' },
});
await assert.rejects(nasRequest('/session/me'), (error) => {
  assert.equal(error.kind, 'unauthenticated');
  assert.equal(error.httpStatus, 401);
  assert.equal(invalidations, 1);
  return true;
});
assert.equal(httpCalls[3].data.clubId, 'club-a');

await nasRequest('/session/me');
assert.equal(loginCount, 2, '401 clears the old token so the next action logs in again');
assert.equal(httpCalls[5].header.Authorization, 'Bearer nas-token-2');

queuedResponses.push({
  statusCode: 403,
  data: { code: 'membership_invalid', message: 'membership expired' },
});
await assert.rejects(nasRequest('/boards'), (error) => {
  assert.equal(error.kind, 'membership_invalid');
  assert.equal(error.httpStatus, 403);
  assert.equal(invalidations, 2);
  return true;
});

const callsBeforeUnconfiguredProductionProfile = httpCalls.length;
const loginsBeforeUnconfiguredProductionProfile = loginCount;
nasModule.exports.clearAuthToken();
nasRuntime.__config.profile = 'nasProduction';
nasRuntime.__config.apiBaseUrl = '';
await assert.rejects(nasRequest('/session/me'), (error) => {
  assert.equal(error.kind, 'server');
  assert.equal(error.code, 'api_base_url_missing');
  return true;
});
assert.equal(httpCalls.length, callsBeforeUnconfiguredProductionProfile, 'an empty production origin must not send requests');
assert.equal(loginCount, loginsBeforeUnconfiguredProductionProfile, 'an empty production origin must not consume a wx.login code');

nasRuntime.__config.apiBaseUrl = 'https://api.muwei.xyz';
await nasRequest('/session/me');
assert.equal(httpCalls[callsBeforeUnconfiguredProductionProfile].url, 'https://api.muwei.xyz/v1/auth/wechat');
assert.equal(httpCalls[callsBeforeUnconfiguredProductionProfile + 1].url, 'https://api.muwei.xyz/v1/action');

const callsBeforeInvalidProductionOrigins = httpCalls.length;
const loginsBeforeInvalidProductionOrigins = loginCount;
for (const apiBaseUrl of [
  'http://api.muwei.xyz',
  'https://user@api.muwei.xyz',
  'https://api.muwei.xyz/',
  'https://api.muwei.xyz/v1',
  'https://api.muwei.xyz?target=other',
  'https://api.muwei.xyz#fragment',
  ' https://api.muwei.xyz',
  'https://api.muwei.xyz:65536',
  'https://-invalid.api.muwei.xyz',
]) {
  nasModule.exports.clearAuthToken();
  nasRuntime.__config.apiBaseUrl = apiBaseUrl;
  await assert.rejects(nasRequest('/session/me'), (error) => {
    assert.equal(error.kind, 'server');
    assert.equal(error.code, 'api_base_url_invalid');
    return true;
  }, `${apiBaseUrl} must not be accepted as a production origin`);
}
assert.equal(httpCalls.length, callsBeforeInvalidProductionOrigins, 'invalid production origins must not send requests');
assert.equal(loginCount, loginsBeforeInvalidProductionOrigins, 'invalid production origins must not consume a wx.login code');

console.log('OK: CloudBase/NAS transport, server-side login boundary, error mapping, and idempotency checks passed');
