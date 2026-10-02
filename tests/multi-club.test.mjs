import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadTransport() {
  const source = read('api/transport.js')
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
  const module = { exports: {} };
  vm.runInNewContext(read('api/endpoints.js').replace('export default', 'module.exports ='), { module });
  return module.exports;
}

function loadRequest(app, config = {}) {
  const source = read('api/request.js')
    .replace("import config from '~/config';", 'const config = __config;')
    .replace(
      "import { resolveTransport, withIdempotency } from '~/api/transport';",
      'const { resolveTransport, withIdempotency } = __transport;',
    )
    .replace(/export class /g, 'class ')
    .replace('export default function request', 'function request')
    .replace(/export function /g, 'function ')
    .replace('export { DEFAULT_MESSAGE };', '')
    .concat('\nmodule.exports = { request, requestForClub };');
  const module = { exports: {} };
  const calls = [];
  let callBehavior = () => Promise.resolve({ result: { code: 0, data: { ok: true } } });
  const wx = { cloud: { callFunction(options) {
    calls.push(plain(options));
    return callBehavior(options);
  } } };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    __config: { cloudFunctionName: 'api', ...config },
    __transport: loadTransport(),
    getApp: () => app,
    wx,
    setTimeout,
    clearTimeout,
  });
  return { ...module.exports, calls, wx, setCallBehavior(behavior) { callBehavior = behavior; } };
}

function loadApp({ sessions, memberships, unreadResponses = [] }) {
  const source = read('app.js')
    .replace("import config from './config';", 'const config = __config;')
    .replace("import createBus from './utils/eventBus';", 'const createBus = __createBus;')
    .replace("import { fetchUnreadCount } from './services/notifications';", 'const fetchUnreadCount = __fetchUnreadCount;')
    .replace(
      /import \{[\s\S]*?clearAccountScope,[\s\S]*?\} from '\.\/services\/session';/,
      'const { bootstrapSession, refreshSessionFromServer, refreshSessionForClub, setCurrentSession, setSessionWithoutClub, clearAccountScope } = __session;',
    )
    .replace("import { fetchMyClubs } from './services/clubs';", 'const { fetchMyClubs } = __clubs;');
  const holder = {};
  const events = [];
  const storage = new Map();
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    navigateTo: (options) => events.push(['navigateTo', options.url]),
    showToast: () => {},
  };
  const bus = {
    on() {},
    off() {},
    emit(...args) { events.push(args); },
  };
  const sessionApi = {
    async bootstrapSession() { return sessions.base; },
    async refreshSessionFromServer() { return sessions.base; },
    async refreshSessionForClub(id) {
      if (sessions.pending.has(id)) return sessions.pending.get(id);
      return sessions.byClub[id];
    },
    setSessionWithoutClub(session) {
      return { ...session, role: 'guest', memberStatus: 'none', club: null, capabilities: {} };
    },
    setCurrentSession(session) { return session; },
    clearAccountScope() { return { role: 'guest', memberStatus: 'none', user: null, club: null }; },
  };
  vm.runInNewContext(source, {
    App(definition) { holder.definition = definition; },
    __config: {},
    __createBus: () => bus,
    __fetchUnreadCount: () => unreadResponses.shift() || Promise.resolve(0),
    __session: sessionApi,
    __clubs: { async fetchMyClubs() { return memberships; } },
    wx,
  });
  const app = { ...holder.definition, globalData: { ...holder.definition.globalData }, eventBus: bus };
  return { app, events, storage, sessionApi };
}

const user = { id: 'user-1', displayName: '读者' };
const clubA = { id: 'club-a', name: 'A 社' };
const clubB = { id: 'club-b', name: 'B 社' };
const activeA = { user, role: 'admin', memberStatus: 'active', club: clubA, capabilities: { publishing: true } };
const activeB = { user, role: 'member', memberStatus: 'active', club: clubB, capabilities: { publishing: true } };

const { resolveTransport } = loadTransport();
assert.deepEqual(plain(resolveTransport('/clubs', 'GET')), { action: 'clubs/list', payload: {} });
assert.deepEqual(plain(resolveTransport('/clubs/mine', 'GET')), { action: 'clubs/mine', payload: {} });
assert.deepEqual(plain(resolveTransport('/account/me', 'GET')), { action: 'account/me', payload: {} });
assert.deepEqual(plain(resolveTransport('/clubs/club-b', 'GET')), {
  action: 'clubs/detail',
  payload: { id: 'club-b' },
});

const requestApp = {
  globalData: { session: activeA, clubContextVersion: 0, clubSwitching: false },
  invalidatedClubs: 0,
  invalidateClubSelection() { this.invalidatedClubs += 1; },
  invalidateSession() {},
};
const cloud = loadRequest(requestApp);
await cloud.request('/posts', { method: 'POST', data: { body: 'hello', clubId: 'forged' } });
assert.deepEqual(cloud.calls[0].data, {
  action: 'posts/create',
  payload: { body: 'hello' },
  clubId: 'club-a',
});
await cloud.request('/clubs');
assert.deepEqual(cloud.calls[1].data, { action: 'clubs/list', payload: {} });
await cloud.requestForClub('/membership/applications', 'club-b', {
  method: 'POST',
  data: { displayName: '读者', inviteCode: 'join-code' },
});
assert.deepEqual(cloud.calls[2].data, {
  action: 'membership/apply',
  payload: { displayName: '读者', inviteCode: 'join-code' },
  clubId: 'club-b',
});
let rejectARequest;
cloud.setCallBehavior(() => new Promise((resolve) => { rejectARequest = resolve; }));
const oldClubRequest = cloud.request('/posts');
requestApp.globalData.clubContextVersion += 1;
requestApp.globalData.session = activeB;
rejectARequest({ result: { code: 'membership_invalid', message: 'A membership changed' } });
await assert.rejects(oldClubRequest, (error) => error.code === 'club_context_changed');
assert.equal(requestApp.invalidatedClubs, 0, 'a late membership error from A must not invalidate the new B selection');

const memory = new Map();
let currentClub = clubA;
const fakeApi = {
  request: async () => null,
  clearAuthToken() {},
};
const sessionSource = read('services/session.js')
  .replace("import request, { clearAuthToken, requestForClub } from '~/api/request';", 'const { request, clearAuthToken, requestForClub } = __api;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export async function /g, 'async function ')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'const defaultSessionExports = {')
  .concat('\nmodule.exports = { ...defaultSessionExports, setCurrentSession, setSessionWithoutClub, scopedKey };');
const sessionModule = { exports: {} };
vm.runInNewContext(sessionSource, {
  module: sessionModule,
  exports: sessionModule.exports,
  __api: fakeApi,
  __endpoints: loadEndpoints(),
  getApp: () => ({ globalData: { session: { user, club: currentClub } } }),
  wx: {
    getStorageSync(key) { return memory.get(key); },
    setStorageSync(key, value) { memory.set(key, value); },
    removeStorageSync(key) { memory.delete(key); },
    getStorageInfoSync() { return { keys: [...memory.keys()] }; },
  },
});
const session = sessionModule.exports;
assert.equal(session.scopedKey('draft-index'), 'hg:user-1:club-a:draft-index');
currentClub = clubB;
assert.equal(session.scopedKey('draft-index'), 'hg:user-1:club-b:draft-index');

const draftStorage = new Map([
  ['hg:user-1:draft-index', [
    { id: 'legacy-1', kind: 'fragment', title: '旧黑光草稿', excerpt: '只应在黑光恢复', updatedAt: 10 },
    { id: 'legacy-2', kind: 'fragment', title: '第二篇旧草稿', excerpt: '也要保留', updatedAt: 9 },
  ]],
  ['hg:user-1:draft:legacy-1', { id: 'legacy-1', kind: 'fragment', title: '旧黑光草稿', body: '只应在黑光恢复' }],
  ['hg:user-1:draft:legacy-2', { id: 'legacy-2', kind: 'fragment', title: '第二篇旧草稿', body: '也要保留' }],
]);
let currentSession = { user, role: 'member', memberStatus: 'active', club: clubB };
const draftScope = {
  getSession: () => currentSession,
  scopedKey: (name) => `hg:${currentSession.user.id}:${currentSession.club.id}:${name}`,
};
const legacyDraftSource = read('services/legacy-drafts.js')
  .replace("import { getSession, scopedKey } from '~/services/session';", 'const { getSession, scopedKey } = __draftScope;')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'const defaultLegacyDraftExports = {')
  .concat('\nmodule.exports = { migrateLegacyDraft, migrateLegacyDraftIndex, removeLegacyDraft };');
const legacyDraftModule = { exports: {} };
vm.runInNewContext(legacyDraftSource, {
  module: legacyDraftModule,
  exports: legacyDraftModule.exports,
  __draftScope: draftScope,
  wx: {
    getStorageSync: (key) => draftStorage.get(key),
    setStorageSync: (key, value) => draftStorage.set(key, value),
    removeStorageSync: (key) => draftStorage.delete(key),
  },
});
const communityDraftSource = read('pages/community/drafts.js')
  .replace("import { scopedKey } from '~/services/session';", 'const { scopedKey } = __draftScope;')
  .replace("import { migrateLegacyDraftIndex, removeLegacyDraft } from '~/services/legacy-drafts';", 'const { migrateLegacyDraftIndex, removeLegacyDraft } = __legacyDrafts;')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'module.exports = {');
const communityDraftModule = { exports: {} };
vm.runInNewContext(communityDraftSource.concat('\nmodule.exports = { listDrafts, removeDraft };'), {
  module: communityDraftModule,
  exports: communityDraftModule.exports,
  __draftScope: draftScope,
  __legacyDrafts: legacyDraftModule.exports,
  wx: {
    getStorageSync: (key) => draftStorage.get(key),
    setStorageSync: (key, value) => draftStorage.set(key, value),
    removeStorageSync: (key) => draftStorage.delete(key),
  },
});
assert.deepEqual(plain(communityDraftModule.exports.listDrafts()), [], 'club B must never load unscoped legacy drafts');
draftStorage.set('hg:user-1:heiguang:draft-index', [{ id: 'new-1', kind: 'fragment', title: '社团内新草稿' }]);
draftStorage.set('hg:user-1:heiguang:draft:new-1', { id: 'new-1', clubId: 'heiguang', kind: 'fragment', title: '社团内新草稿' });
currentSession = { ...currentSession, club: { id: 'heiguang', name: '黑光文学社' } };
assert.deepEqual(
  plain(communityDraftModule.exports.listDrafts().map((draft) => draft.id)),
  ['new-1', 'legacy-1', 'legacy-2'],
  'legacy drafts merge by id with newer heiguang drafts even when the current index is non-empty',
);
assert.equal(draftStorage.get('hg:user-1:heiguang:draft:legacy-1').clubId, 'heiguang');
assert.equal(draftStorage.has('hg:user-1:draft:legacy-1'), true, 'legacy source is preserved after restore');
assert.deepEqual(
  plain(communityDraftModule.exports.listDrafts().map((draft) => draft.id)),
  ['new-1', 'legacy-1', 'legacy-2'],
  're-reading the merged index does not duplicate legacy draft rows',
);
currentSession = { ...currentSession, club: clubB };
assert.deepEqual(plain(communityDraftModule.exports.listDrafts()), [], 'restored heiguang drafts stay hidden in club B');

const multiApp = loadApp({
  sessions: {
    base: { user, role: 'member', memberStatus: 'active', club: clubA },
    byClub: { 'club-a': activeA, 'club-b': activeB },
    pending: new Map(),
  },
  memberships: [
    { ...clubA, status: 'active', role: 'admin', memberStatus: 'active' },
    { ...clubB, status: 'active', role: 'member', memberStatus: 'active' },
  ],
});
multiApp.storage.set('hg:user-1:selected-club', 'club-b');
await multiApp.app.initSession();
assert.equal(multiApp.app.globalData.session.club.id, 'club-b', 'restore the last still-valid club');

const chooserApp = loadApp({
  sessions: { base: { user, role: 'member', memberStatus: 'active', club: clubA }, byClub: {}, pending: new Map() },
  memberships: [
    { ...clubA, status: 'active', memberStatus: 'active' },
    { ...clubB, status: 'active', memberStatus: 'active' },
  ],
});
await chooserApp.app.initSession();
assert.equal(chooserApp.app.globalData.session.club, null, 'multiple clubs without a saved choice must not fall back to the server default');
assert.ok(chooserApp.events.some(([type, url]) => type === 'navigateTo' && url.includes('/pages/community/clubs/index')));

const singleClubApp = loadApp({
  sessions: { base: { user, role: 'member', memberStatus: 'active', club: clubA }, byClub: { 'club-a': activeA }, pending: new Map() },
  memberships: [{ ...clubA, status: 'active', role: 'admin', memberStatus: 'active' }],
});
await singleClubApp.app.initSession();
assert.equal(singleClubApp.app.globalData.session.club.id, 'club-a', 'one active membership opens automatically');
assert.equal(singleClubApp.events.some(([type, url]) => type === 'navigateTo' && url.includes('/pages/community/clubs/index')), false);

const failedSwitchApp = loadApp({
  sessions: {
    base: activeA,
    byClub: { 'club-a': activeA, 'club-b': activeB },
    pending: new Map([['club-b', new Promise((resolve, reject) => setTimeout(() => reject(new Error('network down')), 0))]]),
  },
  memberships: [
    { ...clubA, status: 'active', memberStatus: 'active' },
    { ...clubB, status: 'active', memberStatus: 'active' },
  ],
});
failedSwitchApp.storage.set('hg:user-1:selected-club', 'club-a');
await failedSwitchApp.app.initSession();
await assert.rejects(failedSwitchApp.app.selectClub('club-b'));
assert.equal(failedSwitchApp.app.globalData.session.club.id, 'club-a', 'failed switching retains the previously selected club');
assert.equal(failedSwitchApp.storage.get('hg:user-1:selected-club'), 'club-a');

const unreadPending = [];
const raceApp = loadApp({
  sessions: { base: activeA, byClub: { 'club-a': activeA, 'club-b': activeB }, pending: new Map() },
  memberships: [
    { ...clubA, status: 'active', memberStatus: 'active' },
    { ...clubB, status: 'active', memberStatus: 'active' },
  ],
  unreadResponses: [new Promise((resolve) => unreadPending.push(resolve)), Promise.resolve(2)],
});
raceApp.storage.set('hg:user-1:selected-club', 'club-a');
await raceApp.app.initSession();
const olderUnread = raceApp.app.refreshUnreadCount();
assert.equal(raceApp.app.globalData.unreadCount, 0);
await raceApp.app.selectClub('club-b');
unreadPending[0](9);
await olderUnread;
assert.equal(raceApp.app.globalData.session.club.id, 'club-b');
assert.equal(raceApp.app.globalData.unreadCount, 2, 'club B badge stays current; a late club A count cannot replace it');

console.log('OK: multi-club action context, club-scoped cache keys, startup selection, and unread race isolation');
