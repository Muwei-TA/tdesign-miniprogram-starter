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

function loadApp(refreshSessionFromServer) {
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
      bootstrapSession: async () => guestSession,
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

function loadMyPage(app, getSession) {
  const source = read('pages/my/index.js')
    .replace("import request from '~/api/request';", 'const request = __request;')
    .replace(
      "import { getSession, isAdmin, clearAccountScope } from '~/services/session';",
      'const { getSession, isAdmin, clearAccountScope } = __session;',
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
    __request: async () => ({ stats: { posts: 0, bookmarks: 0, topics: 0 } }),
    __session: { getSession, isAdmin: () => false, clearAccountScope: () => guestSession },
    __navigation: { navigateTo() {} },
    wx: { showModal() {}, showToast() {} },
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

const pageApp = { globalData: {}, refreshSession: async () => activeSession };
const memberPage = loadMyPage(pageApp, () => guestSession);
memberPage.page.onLoad();
await memberPage.page.onShow();
assert.equal(memberPage.page.data.isMember, true, 'showing My must sync the active server session into the page');
assert.equal(memberPage.page.data.sessionLoading, false);
assert.equal(memberPage.page.data.sessionError, false);

const inFlight = [deferred(), deferred()];
let showCount = 0;
pageApp.refreshSession = () => inFlight[showCount++].promise;
const olderPageRefresh = memberPage.page.onShow();
const newerPageRefresh = memberPage.page.onShow();
inFlight[1].resolve(activeSession);
await newerPageRefresh;
inFlight[0].resolve(guestSession);
await olderPageRefresh;
assert.equal(memberPage.page.data.isMember, true, 'an older page refresh must not replace a newer result');

pageApp.refreshSession = async () => { throw { kind: 'network' }; };
const unavailablePage = loadMyPage(pageApp, () => guestSession);
unavailablePage.page.onLoad();
await unavailablePage.page.onShow();
assert.equal(unavailablePage.page.data.sessionError, true);
assert.equal(unavailablePage.page.data.isMember, false);

const markup = read('pages/my/index.wxml');
assert.match(markup, /wx:elif="\{\{ sessionError \}\}"[\s\S]*?暂时无法确认成员状态[\s\S]*?bind:action="onSessionRetry"/);
assert.match(markup, /wx:elif="\{\{ isMember \}\}"/);
assert.match(markup, /title="你还不是社内成员"/);
assert.ok(markup.indexOf('wx:elif="{{ sessionError }}"') < markup.indexOf('title="你还不是社内成员"'));

console.log('OK: My refreshes the server session, preserves safe status on overlapping requests, and shows network errors distinctly');
