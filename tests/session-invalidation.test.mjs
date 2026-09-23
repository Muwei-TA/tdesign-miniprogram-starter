import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadTransport() {
  const source = readFileSync(join(ROOT, 'api/transport.js'), 'utf8')
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

function loadApp() {
  const source = readFileSync(join(ROOT, 'app.js'), 'utf8')
    .replace("import config from './config';", 'const config = __config;')
    .replace("import createBus from './utils/eventBus';", 'const createBus = __createBus;')
    .replace(
      "import { fetchUnreadCount } from './services/notifications';",
      'const fetchUnreadCount = __fetchUnreadCount;',
    )
    .replace(
      "import { bootstrapSession, clearAccountScope } from './services/session';",
      'const bootstrapSession = __bootstrapSession; const clearAccountScope = __clearAccountScope;',
    );

  const holder = {};
  const eventCalls = [];
  const bus = {
    on() {},
    off() {},
    emit(...args) {
      eventCalls.push(args);
    },
  };
  const guestSession = { role: 'guest', memberStatus: 'none', user: null };
  const runtime = {
    App(definition) {
      holder.definition = definition;
    },
    __config: {},
    __createBus: () => bus,
    __fetchUnreadCount: async () => 0,
    __bootstrapSession: async () => guestSession,
    __clearAccountScope: () => guestSession,
    wx: {},
    console,
    eventCalls,
  };
  vm.runInNewContext(source, runtime);
  assert.ok(holder.definition, 'app.js must register an App definition');

  const app = {
    ...holder.definition,
    globalData: { ...holder.definition.globalData },
  };
  return { app, eventCalls, guestSession };
}

function loadRequest(app) {
  const source = readFileSync(join(ROOT, 'api/request.js'), 'utf8')
    .replace("import config from '~/config';", 'const config = __config;')
    .replace(
      "import { resolveTransport, withIdempotency } from '~/api/transport';",
      'const { resolveTransport, withIdempotency } = __transport;',
    )
    .replace(/export class /g, 'class ')
    .replace('export default function request', 'function request')
    .replace(/export function /g, 'function ')
    .replace('export { DEFAULT_MESSAGE };', '')
    .concat('\nmodule.exports = { request, ApiError };');

  let cloudBehavior = () => Promise.resolve({ result: { code: 0, message: 'ok', data: null } });
  const cloudCalls = [];
  const runtime = {
    module: { exports: {} },
    exports: {},
    __config: { cloudFunctionName: 'api' },
    __transport: loadTransport(),
    wx: {
      cloud: {
        callFunction(options) {
          cloudCalls.push(options);
          return cloudBehavior(options);
        },
      },
    },
    getApp: () => app,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(source, runtime);

  return {
    request: runtime.module.exports.request,
    setCloudBehavior(behavior) {
      cloudBehavior = behavior;
    },
    cloudCalls,
  };
}

const { app, eventCalls, guestSession } = loadApp();
let invalidations = 0;
const originalInvalidate = app.invalidateSession;
app.invalidateSession = function invalidateSessionForTest() {
  invalidations += 1;
  return originalInvalidate.call(this);
};

const { request, setCloudBehavior, cloudCalls } = loadRequest(app);

setCloudBehavior(() =>
  Promise.resolve({
    result: {
      code: 'unauthenticated',
      message: '会话原始错误',
      detail: { source: 'test' },
    },
  }),
);
await assert.rejects(request('/session/me'), (error) => {
  assert.equal(error.kind, 'unauthenticated');
  assert.equal(error.message, '会话原始错误');
  assert.deepEqual(error.detail, { source: 'test' });
  return true;
});
assert.equal(invalidations, 1, 'unauthenticated must invalidate the app session exactly once');

setCloudBehavior(() =>
  Promise.resolve({
    result: { code: 'membership_invalid', message: '成员资格原始错误' },
  }),
);
await assert.rejects(request('/posts'), (error) => {
  assert.equal(error.kind, 'membership_invalid');
  assert.equal(error.message, '成员资格原始错误');
  return true;
});
assert.equal(invalidations, 2, 'membership_invalid must invalidate the app session');

setCloudBehavior(() => Promise.reject({ errMsg: 'request:fail socket closed' }));
await assert.rejects(request('/session/me'), (error) => {
  assert.equal(error.kind, 'network');
  return true;
});
assert.equal(invalidations, 2, 'network errors must not invalidate the app session');

setCloudBehavior(() => new Promise(() => {}));
await assert.rejects(request('/session/me', { timeout: 5 }), (error) => {
  assert.equal(error.kind, 'timeout');
  return true;
});
assert.equal(invalidations, 2, 'timeouts must not invalidate the app session');

assert.equal(app.globalData.session, guestSession);
assert.equal(app.globalData.unreadCount, 0);
assert.ok(eventCalls.some(([name]) => name === 'session-changed'));
assert.ok(eventCalls.some(([name, value]) => name === 'notice-unread-change' && value === 0));
assert.ok(cloudCalls.length >= 4);

console.log(
  'OK: actual request VM preserves business errors, invalidates only auth failures, and runs app.invalidateSession',
);
