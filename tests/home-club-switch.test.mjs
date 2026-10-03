import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPageModule } from './helpers/page-module-loader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const homeFeed = await loadPageModule(new URL('../pages/home/feed.js', import.meta.url), ['createHomeFeed']);
const homePostActions = await loadPageModule(new URL('../pages/home/post-actions.js', import.meta.url), ['createHomePostActions']);
const homeWxml = readFileSync(new URL('../pages/home/index.wxml', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

const clubA = { id: 'club-a', name: 'A 社' };
const clubB = { id: 'blackbox-animation', name: 'B 社' };
let currentSession = { user: { id: 'user-1' }, role: 'admin', memberStatus: 'active', club: clubA };
const listeners = new Map();
const feedCalls = [];
const boardCalls = [];
const bus = {
  on(name, callback) {
    const callbacks = listeners.get(name) || new Set();
    callbacks.add(callback);
    listeners.set(name, callbacks);
  },
  off(name, callback) {
    listeners.get(name)?.delete(callback);
  },
  emit(name, value) {
    for (const callback of listeners.get(name) || []) callback(value);
  },
};
const app = {
  globalData: { session: currentSession, unreadCount: 0 },
  eventBus: bus,
  refreshUnreadCount: async () => {},
};
const source = readFileSync(join(ROOT, 'pages/home/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace(/import \{[\s\S]*?FEED_FILTERS,\r?\n\} from '~\/services\/posts';/, 'const { fetchFeed, toggleReaction, toggleBookmark, shrinkVisibility, deletePost, FEED_FILTERS } = __posts;')
  .replace("import { fetchBoards } from '~/services/boards';", 'const { fetchBoards } = __boards;')
  .replace("import { previewPostImage } from '~/services/image-preview';", 'const { previewPostImage } = __helpers;')
  .replace("import { getCapabilities, getSession } from '~/services/session';", 'const { getCapabilities, getSession } = __helpers;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __helpers;')
  .replace("import { createHomeFeed } from './feed';", 'const { createHomeFeed } = __homeFeed;')
  .replace("import { createHomePostActions } from './post-actions';", 'const { createHomePostActions } = __homePostActions;');

let definition;
vm.runInNewContext(source, {
  Page(value) { definition = value; },
  getApp: () => app,
  wx: { showToast() {} },
  __posts: {
    FEED_FILTERS: [{ value: 'all', label: '全部' }],
    fetchFeed(input) {
      const pending = deferred();
      feedCalls.push({ clubId: currentSession.club.id, input, ...pending });
      return pending.promise;
    },
    toggleReaction: async () => {},
    toggleBookmark: async () => {},
    shrinkVisibility: async () => {},
    deletePost: async () => {},
  },
  __boards: {
    fetchBoards(input) {
      const pending = deferred();
      boardCalls.push({ clubId: currentSession.club.id, input, ...pending });
      return pending.promise;
    },
  },
  __helpers: {
    previewPostImage() {},
    getCapabilities: () => currentSession.capabilities || {},
    getSession: () => currentSession,
    navigateTo() {},
  },
  __homeFeed: homeFeed,
  __homePostActions: homePostActions,
});

const page = Object.create(definition);
page.data = { ...definition.data };
page.setData = (patch, callback) => {
  Object.assign(page.data, patch);
  if (callback) callback();
};
page.onLoad();

assert.deepEqual(feedCalls.map((call) => call.clubId), ['club-a']);
assert.deepEqual(boardCalls.map((call) => call.clubId), ['club-a']);
feedCalls[0].resolve({ items: [{ id: 'post-a' }], nextCursor: 'cursor-a', club: clubA });
boardCalls[0].resolve({ items: [{ id: 'board-a', title: 'A 板块', status: 'active' }] });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(Array.from(page.data.list, (item) => item.id), ['post-a']);
assert.deepEqual(Array.from(page.data.filters, (item) => item.value), ['all', 'board-a']);

Object.assign(page.data, {
  selectedBoardId: 'board-a',
  nextCursor: 'cursor-a',
  hasMore: true,
  loading: false,
  loadingMore: true,
  stale: true,
  errorText: 'A 社旧错误',
});
currentSession = { user: { id: 'user-1' }, role: 'member', memberStatus: 'active', club: clubB };
app.globalData.session = currentSession;
assert.doesNotThrow(() => bus.emit('session-changed', currentSession));

assert.equal(page.data.clubName, 'B 社');
assert.equal(page.data.isMember, true);
assert.equal(page.data.selectedBoardId, '');
assert.deepEqual(Array.from(page.data.filters, (item) => item.value), ['all']);
assert.deepEqual(Array.from(page.data.list), []);
assert.equal(page.data.nextCursor, null);
assert.equal(page.data.hasMore, false);
assert.equal(page.data.loading, true);
assert.equal(page.data.loadingMore, false);
assert.equal(page.data.stale, false);
assert.equal(page.data.errorText, '');
assert.equal(page.data.recommendationState, 'loading');
assert.deepEqual(feedCalls.map((call) => call.clubId), ['club-a', 'blackbox-animation'], 'the B session change must issue a new-club feed read');
assert.deepEqual(boardCalls.map((call) => call.clubId), ['club-a', 'blackbox-animation'], 'the B session change must issue a new-club board read');
assert.equal(page.data.isBlackbox, true);

feedCalls[1].resolve({ items: [{ id: 'post-b1' }, { id: 'post-b2' }, { id: 'post-b3' }], nextCursor: null, club: clubB });
boardCalls[1].resolve({ items: [{ id: 'board-b', title: 'B 板块', status: 'active' }] });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(Array.from(page.data.list, (item) => item.id), ['post-b1', 'post-b2', 'post-b3']);
assert.deepEqual(Array.from(page.data.waterfallColumns, (column) => Array.from(column.items, (item) => item.id)), [['post-b1', 'post-b3'], ['post-b2']]);
assert.equal(page.data.loading, false);
assert.equal(page.data.errorText, '');
assert.deepEqual(Array.from(page.data.filters, (item) => item.value), ['all', 'board-b']);
assert.equal(page.data.recommendationState, 'ready');

const clubC = { id: 'club-c', name: 'C 社' };
currentSession = { user: { id: 'user-1' }, role: 'member', memberStatus: 'active', club: clubC };
app.globalData.session = currentSession;
bus.emit('session-changed', currentSession);
assert.equal(page.data.isBlackbox, false);
assert.deepEqual(Array.from(page.data.waterfallColumns, (column) => column.items.length), [0, 0]);
assert.equal(page.data.list.length, 0);
feedCalls[2].resolve({ items: [{ id: 'post-c' }], nextCursor: null, club: clubC });
boardCalls[2].resolve({ items: [] });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(Array.from(page.data.list, (item) => item.id), ['post-c']);
assert.deepEqual(Array.from(page.data.waterfallColumns, (column) => column.items.length), [0, 0]);
assert.match(homeWxml, /mode="waterfall"/);
assert.match(homeWxml, /post="\{\{ list\[postItem\.index\] \}\}"/);

console.log('OK: home clears A state and loads B feed and recommendations on session change');
