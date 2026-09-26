import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadSessionService(request) {
  const source = read('services/session.js')
    .replace("import request from '~/api/request';", 'const request = __request;')
    .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ')
    .replace(/export default \{[\s\S]*?\};\s*$/, '')
    .concat('\nmodule.exports = { bootstrapSession, refreshSessionFromServer, getSession, clearAccountScope };');
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    __request: request,
    __endpoints: { sessionMe: '/session/me' },
    wx: { getStorageInfoSync: () => ({ keys: [] }), removeStorageSync() {} },
  });
  return module.exports;
}

const responses = [];
const sessionService = loadSessionService((url) => {
  assert.equal(url, '/session/me');
  const response = deferred();
  responses.push(response);
  return response.promise;
});

const olderRefresh = sessionService.refreshSessionFromServer();
const newerRefresh = sessionService.refreshSessionFromServer();
const activeSession = { role: 'member', memberStatus: 'active', user: { displayName: '成员' } };
responses[1].resolve(activeSession);
await newerRefresh;
responses[0].resolve({ role: 'guest', memberStatus: 'none', user: null });
await olderRefresh;
assert.equal(sessionService.getSession().memberStatus, 'active', 'an older response must not replace a newer session');

const refreshBeforeLogout = sessionService.refreshSessionFromServer();
const guestSession = sessionService.clearAccountScope();
responses[2].resolve(activeSession);
await refreshBeforeLogout;
assert.equal(sessionService.getSession().memberStatus, 'none', 'a response started before logout must not restore membership');
assert.equal(guestSession.memberStatus, 'none');

function loadApp(refreshSessionFromServer, bootstrapSession = async () => guestSession) {
  const source = read('app.js')
    .replace("import config from './config';", 'const config = __config;')
    .replace("import createBus from './utils/eventBus';", 'const createBus = __createBus;')
    .replace("import { fetchUnreadCount } from './services/notifications';", 'const fetchUnreadCount = __fetchUnreadCount;')
    .replace(
      /import \{[\s\S]*?\} from '\.\/services\/session';/,
      'const { bootstrapSession, refreshSessionFromServer, clearAccountScope } = __session;',
    );
  let definition;
  const events = [];
  const bus = {
    on() {},
    off() {},
    emit(...args) { events.push(args); },
  };
  vm.runInNewContext(source, {
    App(value) { definition = value; },
    __config: {},
    __createBus: () => bus,
    __fetchUnreadCount: async () => 0,
    __session: {
      bootstrapSession,
      refreshSessionFromServer,
      clearAccountScope: () => guestSession,
    },
    wx: {},
  });
  const app = { ...definition, globalData: { ...definition.globalData }, eventBus: bus };
  return { app, events };
}

const appHarness = loadApp(async () => activeSession);
assert.equal(await appHarness.app.refreshSession(), activeSession);
assert.equal(appHarness.app.globalData.session, activeSession);
assert.ok(appHarness.events.some(([name, session]) => name === 'session-changed' && session === activeSession));

function loadMyPage(app, getSession, { request = async () => ({ stats: { posts: 0, bookmarks: 0, topics: 0 } }), wxOverrides = {} } = {}) {
  const source = read('pages/my/index.js')
    .replace("import request from '~/api/request';", 'const request = __request;')
    .replace(
      "import { getSession, isAdmin } from '~/services/session';",
      'const { getSession, isAdmin } = __session;',
    )
    .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');
  let definition;
  const listeners = new Map();
  app.eventBus = {
    on(name, callback) { listeners.set(name, callback); },
    off(name) { listeners.delete(name); },
    emit(name, value) {
      const callback = listeners.get(name);
      if (callback) callback(value);
    },
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    getApp: () => app,
    __request: request,
    __session: { getSession, isAdmin: () => false },
    __navigation: { navigateTo() {} },
    wx: {
      showModal(options) {
        if (options.success) options.success({ confirm: true });
      },
      showToast() {},
      stopPullDownRefresh() {},
      ...wxOverrides,
    },
  });
  const page = {
    data: { ...definition.data },
    setData(updates, callback) {
      Object.assign(this.data, updates);
      if (callback) callback();
    },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') page[key] = value;
  });
  return { definition, page };
}

const pendingBootstrap = deferred();
const coldAppHarness = loadApp(async () => activeSession, () => pendingBootstrap.promise);
let pageRefreshCalls = 0;
let pullDownStops = 0;
const appRefreshSession = coldAppHarness.app.refreshSession;
coldAppHarness.app.refreshSession = function refreshSession(...args) {
  pageRefreshCalls += 1;
  return appRefreshSession.apply(this, args);
};
const initSession = coldAppHarness.app.initSession();
let profileLoads = 0;
const coldPage = loadMyPage(coldAppHarness.app, () => guestSession, {
  request: async () => {
    profileLoads += 1;
    return { stats: { posts: 1, bookmarks: 2, topics: 3 } };
  },
  wxOverrides: { stopPullDownRefresh() { pullDownStops += 1; } },
});
coldPage.page.onLoad();
coldPage.page.onShow();
coldPage.page.onShow();
assert.equal(pageRefreshCalls, 0, 'repeatedly showing My must not request /session/me');
assert.equal(coldPage.page.data.session, null, 'the bootstrap placeholder guest must not become a final page state');
assert.equal(coldPage.page.data.sessionLoading, true, 'My stays loading while the app bootstrap is pending');
pendingBootstrap.resolve(activeSession);
await initSession;
assert.equal(coldPage.page.data.isMember, true, 'the asynchronous app bootstrap must update My through session-changed');
assert.equal(coldPage.page.data.sessionLoading, false);
assert.equal(coldPage.page.data.sessionError, false);
assert.equal(profileLoads, 1, 'publishing an active session from guest loads the member profile');
assert.equal(pageRefreshCalls, 0);

const coldSessionPage = coldPage.page;
const refreshResponses = [deferred(), deferred()];
let refreshIndex = 0;
coldAppHarness.app.refreshSession = () => refreshResponses[refreshIndex++].promise;
const olderPageRefresh = coldSessionPage.refreshSession();
const newerPageRefresh = coldSessionPage.refreshSession();
refreshResponses[1].resolve(activeSession);
await newerPageRefresh;
refreshResponses[0].resolve(guestSession);
await olderPageRefresh;
assert.equal(coldSessionPage.data.isMember, true, 'an older page refresh must not replace a newer result');

const publishedRefresh = deferred();
coldAppHarness.app.refreshSession = async () => {
  coldAppHarness.app.publishSession(activeSession);
  return publishedRefresh.promise;
};
const eventCompletedRefresh = coldSessionPage.refreshSession();
assert.equal(coldSessionPage.data.sessionLoading, false, 'the published refresh event ends the loading state');
publishedRefresh.resolve(activeSession);
await eventCompletedRefresh;
assert.equal(coldSessionPage.data.sessionError, false, 'a refresh completed through publishSession clears the error state');

let invalidationCalls = 0;
coldAppHarness.app.invalidateSession = () => {
  invalidationCalls += 1;
  coldAppHarness.app.globalData.session = guestSession;
  coldAppHarness.app.eventBus.emit('session-changed', guestSession);
};
const pendingAtLogout = deferred();
coldAppHarness.app.refreshSession = () => pendingAtLogout.promise;
const pageRefreshBeforeLogout = coldSessionPage.refreshSession();
coldSessionPage.data.profile = { displayName: '成员' };
coldSessionPage.data.stats = { posts: 1, bookmarks: 2, topics: 3 };
coldSessionPage.onLogout();
pendingAtLogout.resolve(activeSession);
await pageRefreshBeforeLogout;
assert.equal(invalidationCalls, 1, 'logout must use the app-level session invalidation path');
assert.equal(coldSessionPage.data.session.memberStatus, 'none');
assert.equal(coldSessionPage.data.isMember, false, 'an old in-flight response must not restore membership after logout');
assert.equal(coldSessionPage.data.sessionLoading, false);
assert.equal(coldSessionPage.data.profile, null);
assert.deepEqual(JSON.parse(JSON.stringify(coldSessionPage.data.stats)), { posts: 0, bookmarks: 0, topics: 0 });

coldAppHarness.app.refreshSession = async () => { throw { kind: 'network' }; };
await coldSessionPage.onSessionRetry();
assert.equal(coldSessionPage.data.sessionError, true, 'the explicit retry must report network errors');
await coldSessionPage.onPullDownRefresh();
assert.equal(coldSessionPage.data.sessionError, true, 'manual pull-to-refresh reports a network error without changing session');
assert.equal(pullDownStops, 1, 'the platform pull-down spinner is stopped after the request');

const markup = read('pages/my/index.wxml');
assert.match(markup, /wx:elif="\{\{ sessionError \}\}"[\s\S]*?暂时无法确认成员状态[\s\S]*?bind:action="onSessionRetry"/);
assert.match(markup, /wx:elif="\{\{ isMember \}\}"/);
assert.match(markup, /title="你还不是社内成员"/);
assert.ok(markup.indexOf('wx:elif="{{ sessionError }}"') < markup.indexOf('title="你还不是社内成员"'));
assert.equal(JSON.parse(read('pages/my/index.json')).enablePullDownRefresh, true);

console.log('OK: My uses app session events, avoids Tab refresh requests, and guards explicit refreshes against stale responses');
