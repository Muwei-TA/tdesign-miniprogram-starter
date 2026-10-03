import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function loadPage(path, replacements, globals = {}) {
  let definition;
  let source = read(path).replace("import Page from '~/utils/themed-page';", '');
  replacements.forEach(([pattern, replacement]) => {
    source = source.replace(pattern, replacement);
  });
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    ...globals,
  });
  assert.ok(definition, `${path} must register a Page definition`);
  return definition;
}

function pageContext(definition, patch = {}) {
  const context = {
    data: { ...definition.data, ...patch },
    setData(updates, callback) {
      Object.assign(this.data, updates);
      if (callback) callback();
    },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') context[key] = value;
  });
  return context;
}

const navigations = [];
const modals = [];
let notificationFetches = 0;
let delayNotificationFetches = false;
const pendingNotificationFetches = [];
let messageUnreadRefreshes = 0;
const messageApp = {
  globalData: { session: { role: 'member', memberStatus: 'active', club: { id: 'club-a' } } },
  eventBus: { on() {}, off() {}, emit() {} },
  setUnreadCount() {},
  refreshUnreadCount() {
    messageUnreadRefreshes += 1;
    return Promise.resolve();
  },
};
const messagePage = loadPage(
  'pages/message/index.js',
  [
    [
      "import { fetchNotifications, markAllRead } from '~/services/notifications';",
      'const { fetchNotifications, markAllRead } = __notifications;',
    ],
    ["import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;'],
  ],
  {
    __notifications: {
      async fetchNotifications() {
        notificationFetches += 1;
        if (delayNotificationFetches) {
          let resolve;
          const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
          pendingNotificationFetches.push({ resolve, promise });
          return promise;
        }
        return { items: [] };
      },
      markAllRead: async () => {},
    },
    __navigation: { navigateTo: (url) => navigations.push(url) },
    getApp: () => messageApp,
    wx: { showModal: (options) => modals.push(options) },
  },
);
const messages = pageContext(messagePage, { tab: 'system' });

const lifecycleMessages = pageContext(messagePage, { tab: 'system' });
messagePage.onLoad.call(lifecycleMessages);
assert.equal(notificationFetches, 1, 'opening the page should load its notification list once');
messagePage.onShow.call(lifecycleMessages);
assert.equal(notificationFetches, 1, 'the initial Page.onShow should not duplicate onLoad');
await messagePage.onShow.call(lifecycleMessages);
assert.equal(notificationFetches, 2, 'showing the page again should refresh the selected notification list');
assert.equal(messageUnreadRefreshes, 1, 'showing the page again should also refresh the badge count');

delayNotificationFetches = true;
const olderMessageRefresh = messagePage.loadList.call(lifecycleMessages);
const newerMessageRefresh = messagePage.loadList.call(lifecycleMessages);
pendingNotificationFetches[1].resolve({ items: [{ id: 'message-newer' }] });
await newerMessageRefresh;
pendingNotificationFetches[0].resolve({ items: [{ id: 'message-older' }] });
await olderMessageRefresh;
delayNotificationFetches = false;
assert.deepEqual(lifecycleMessages.data.list.map((item) => item.id), ['message-newer']);

for (const queue of ['content', 'comment', 'topic', 'board', 'member', 'report', 'collection', 'appeals']) {
  messages.data.list = [{
    id: `notice-${queue}`,
    target: { type: 'admin_queue', queue, id: queue, accessible: true },
  }];
  messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: `notice-${queue}` } } });
  assert.equal(navigations.at(-1), '/pages/admin/reviews/index');
}

messages.data.list = [{
  id: 'appeal-notice',
  target: { type: 'admin_appeals', queue: 'appeals', id: 'appeals', accessible: true },
}];
messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: 'appeal-notice' } } });
assert.equal(navigations.at(-1), '/pages/admin/reviews/index');

const navigationCount = navigations.length;
for (const target of [
  { type: 'admin_queue', queue: 'constructor', id: 'constructor', accessible: true },
  { type: 'admin_queue', queue: 'report', id: 'content', accessible: true },
  { type: 'admin_queue', queue: 'content', id: 'content', accessible: false },
  { type: 'admin_appeals', queue: 'content', id: 'appeals', accessible: true },
]) {
  messages.data.list = [{ id: 'invalid-admin-notice', target }];
  messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: 'invalid-admin-notice' } } });
}
assert.equal(navigations.length, navigationCount, 'invalid admin targets must not navigate');

messages.data.tab = 'reply';
messages.data.list = [{
  id: 'reply-admin-target',
  target: { type: 'admin_queue', queue: 'content', id: 'content', accessible: true },
}];
messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: 'reply-admin-target' } } });
assert.equal(navigations.length, navigationCount, 'admin targets are only actionable from the system tab');

const modalCount = modals.length;
messages.data.list = [{ id: 'broken-notice' }];
messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: 'broken-notice' } } });
assert.equal(modals.length, modalCount + 1, 'a missing target should fail closed with a neutral message');

messages.data.list = [{ id: 'post-notice', target: { type: 'post', id: 'post/with space', accessible: true } }];
messagePage.onItemTap.call(messages, { currentTarget: { dataset: { id: 'post-notice' } } });
assert.equal(navigations.at(-1), '/pages/community/post/index?id=post%2Fwith%20space&from=notice');

const appBus = { on() {}, off() {}, emit() {} };
const adminNavigations = [];
const adminPage = loadPage(
  'pages/admin/index.js',
  [
    ["import { fetchUsageStatus } from './usage';", 'const { fetchUsageStatus } = __usage;'],
    ["import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;'],
  ],
  {
    __usage: { fetchUsageStatus: async () => ({}) },
    __navigation: { navigateTo: (url) => adminNavigations.push(url) },
    getApp: () => ({ eventBus: appBus, globalData: { session: null } }),
    wx: { getStorageSync() { return ''; }, setStorageSync() {}, removeStorageSync() {}, navigateTo() {} },
  },
);
const admin = pageContext(adminPage);
adminPage.onLoad.call(admin);
adminPage.onReviewsPage.call(admin);
assert.equal(adminNavigations.at(-1), '/pages/admin/reviews/index');

function loadApp(session, fetchUnreadCount = null) {
  let definition;
  let unreadCalls = 0;
  const events = [];
  const source = read('app.js')
    .replace("import config from './config';", 'const config = __config;')
    .replace("import createBus from './utils/eventBus';", 'const createBus = __createBus;')
    .replace("import { fetchUnreadCount } from './services/notifications';", 'const fetchUnreadCount = __fetchUnreadCount;')
    .replace(/import \{[\s\S]*?\} from '\.\/services\/session';/, 'const { bootstrapSession, refreshSessionFromServer, refreshSessionForClub, setCurrentSession, setSessionWithoutClub, clearAccountScope } = __session;')
    .replace("import { fetchMyClubs } from './services/clubs';", 'const { fetchMyClubs } = __clubs;');
  const selectedClub = session && session.club;
  const accountSession = session && session.user
    ? { ...session, role: 'guest', memberStatus: 'none', club: null }
    : session;
  vm.runInNewContext(source, {
    App(value) { definition = value; },
    __config: {},
    __createBus: () => ({ on() {}, off() {}, emit(...args) { events.push(args); } }),
    __fetchUnreadCount: () => {
      unreadCalls += 1;
      return fetchUnreadCount ? fetchUnreadCount(unreadCalls) : Promise.resolve(unreadCalls);
    },
    __session: {
      bootstrapSession: async () => accountSession,
      refreshSessionFromServer: async () => session,
      refreshSessionForClub: async () => session,
      setCurrentSession: (value) => value,
      setSessionWithoutClub: (value) => ({ ...value, role: 'guest', memberStatus: 'none', club: null }),
      clearAccountScope: () => ({ role: 'guest', memberStatus: 'none' }),
    },
    __clubs: { fetchMyClubs: async () => selectedClub ? [{ ...selectedClub, status: 'active', memberStatus: 'active' }] : [] },
    wx: { getStorageSync() { return ''; }, setStorageSync() {}, removeStorageSync() {}, navigateTo() {} },
  });
  const app = { ...definition, globalData: { ...definition.globalData } };
  return { app, events, unreadCalls: () => unreadCalls };
}

const activeApp = loadApp({ role: 'member', memberStatus: 'active', user: { id: 'member-a' }, club: { id: 'club-a' } });
await activeApp.app.initSession();
await activeApp.app.unreadCountRefreshPromise;
assert.equal(activeApp.unreadCalls(), 1, 'cold start should keep its existing post-session unread fetch');
await activeApp.app.onShow();
assert.equal(activeApp.unreadCalls(), 1, 'the initial show should not duplicate the cold-start fetch');
activeApp.app.onHide();
await activeApp.app.onShow();
assert.equal(activeApp.unreadCalls(), 2, 'returning from background should refresh unread count');
assert.equal(activeApp.app.globalData.unreadCount, 2);

const guestApp = loadApp({ role: 'guest', memberStatus: 'none' });
await guestApp.app.initSession();
guestApp.app.onHide();
await guestApp.app.onShow();
assert.equal(guestApp.unreadCalls(), 0, 'guest sessions must not request an unread count');

let resolveUnreadCount;
const pendingUnreadCount = new Promise((resolve) => { resolveUnreadCount = resolve; });
const coalescedApp = loadApp(
  { role: 'member', memberStatus: 'active', user: { id: 'member-a' }, club: { id: 'club-a' } },
  () => pendingUnreadCount,
);
coalescedApp.app.publishSession({ role: 'member', memberStatus: 'active', user: { id: 'member-a' }, club: { id: 'club-a' } });
const firstUnreadRefresh = coalescedApp.app.refreshUnreadCount();
const overlappingUnreadRefresh = coalescedApp.app.refreshUnreadCount();
assert.equal(coalescedApp.unreadCalls(), 1, 'overlapping lifecycle refreshes should share one request');
resolveUnreadCount(7);
await Promise.all([firstUnreadRefresh, overlappingUnreadRefresh]);
assert.equal(coalescedApp.app.globalData.unreadCount, 7);

let resolveOldAccountCount;
const oldAccountCount = new Promise((resolve) => { resolveOldAccountCount = resolve; });
const logoutRaceApp = loadApp(
  { role: 'member', memberStatus: 'active', user: { id: 'member-a' }, club: { id: 'club-a' } },
  (call) => (call === 1 ? oldAccountCount : Promise.resolve(6)),
);
await logoutRaceApp.app.initSession();
const oldAccountRefresh = logoutRaceApp.app.unreadCountRefreshPromise;
assert.equal(logoutRaceApp.unreadCalls(), 1);
logoutRaceApp.app.invalidateSession();
assert.equal(logoutRaceApp.app.globalData.unreadCount, 0, 'logout should clear the prior account badge immediately');
resolveOldAccountCount(12);
await oldAccountRefresh;
assert.equal(logoutRaceApp.app.globalData.unreadCount, 0, 'a late pre-logout response must not restore the old account badge');

logoutRaceApp.app.publishSession({ role: 'member', memberStatus: 'active', user: { id: 'member-b' }, club: { id: 'club-a' } });
await logoutRaceApp.app.refreshUnreadCount();
assert.equal(logoutRaceApp.unreadCalls(), 2, 'a new account should start a fresh unread request');
assert.equal(logoutRaceApp.app.globalData.unreadCount, 6, 'the new account response should update the badge');

let resolveRevokedSessionCount;
const revokedSessionCount = new Promise((resolve) => { resolveRevokedSessionCount = resolve; });
const revocationRaceApp = loadApp(
  { role: 'moderator', memberStatus: 'active', user: { id: 'moderator-a' }, club: { id: 'club-a' } },
  (call) => (call === 1 ? revokedSessionCount : Promise.resolve(3)),
);
await revocationRaceApp.app.initSession();
const revokedSessionRefresh = revocationRaceApp.app.unreadCountRefreshPromise;
revocationRaceApp.app.setUnreadCount(4);
revocationRaceApp.app.publishSession({ role: 'member', memberStatus: 'removed', user: { id: 'moderator-a' }, club: { id: 'club-a' } });
const currentSessionRefresh = revocationRaceApp.app.unreadCountRefreshPromise;
assert.equal(revocationRaceApp.app.globalData.unreadCount, 0, 'a role or membership change should clear the previous badge immediately');
resolveRevokedSessionCount(15);
await revokedSessionRefresh;
await currentSessionRefresh;
assert.equal(revocationRaceApp.unreadCalls(), 1, 'a removed member cannot start another club unread request');
assert.equal(revocationRaceApp.app.globalData.unreadCount, 0, 'a removed member cannot restore the badge');

const homeApp = {
  globalData: { session: { role: 'member', memberStatus: 'active' } },
  refreshUnreadCountCalls: 0,
  refreshUnreadCount() { this.refreshUnreadCountCalls += 1; },
  eventBus: { on() {}, off() {} },
};
const homePage = loadPage(
  'pages/home/index.js',
  [
    [
      /import \{[\s\S]*?\} from '~\/services\/posts';/,
      'const { fetchFeed, toggleReaction, toggleBookmark, shrinkVisibility, deletePost, FEED_FILTERS } = __posts;',
    ],
    ["import { fetchBoards } from '~/services/boards';", 'const { fetchBoards } = __boards;'],
    ["import { previewPostImage } from '~/services/image-preview';", 'const { previewPostImage } = __imagePreview;'],
    [
      "import { getCapabilities, getSession } from '~/services/session';",
      'const { getCapabilities, getSession } = __session;',
    ],
    ["import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;'],
    ["import { createHomeFeed } from './feed';", 'const { createHomeFeed } = __homeFeed;'],
    ["import { createHomePostActions } from './post-actions';", 'const { createHomePostActions } = __homePostActions;'],
  ],
  {
    __posts: {
      fetchFeed: async () => ({ items: [] }),
      toggleReaction() {}, toggleBookmark() {}, shrinkVisibility() {}, deletePost() {}, FEED_FILTERS: [],
    },
    __boards: { fetchBoards: async () => ({ items: [] }) },
    __imagePreview: { previewPostImage() {} },
    __session: { getCapabilities: () => ({}), getSession: () => homeApp.globalData.session },
    __navigation: { navigateTo() {} },
    __homeFeed: { createHomeFeed: () => ({ loadRecommendations() {} }) },
    __homePostActions: { createHomePostActions: () => ({}) },
    getApp: () => homeApp,
    wx: {},
  },
);
const home = pageContext(homePage);
homePage.onShow.call(home);
assert.equal(homeApp.refreshUnreadCountCalls, 0, 'the initial Home.onShow should leave cold-start counting to initSession');
homePage.onShow.call(home);
assert.equal(homeApp.refreshUnreadCountCalls, 1, 'returning to Home should refresh the unread badge');

console.log('OK: admin notification targets are allowlisted, queue deep links select safely, and foreground refresh preserves cold-start behavior');
