import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loadPage(path, services = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
  let page;
  const app = {
    globalData: { session: { role: 'member' }, unreadCount: 0 },
    eventBus: { on() {}, off() {}, emit() {} },
    refreshUnreadCount: async () => {},
  };
  vm.runInNewContext(source, {
    Page: (value) => { page = value; },
    getApp: () => app,
    getSession: () => ({ user: { id: 'u1' }, memberStatus: 'active' }),
    getCapabilities: () => ({}),
    fetchProfile: async () => ({ user: { id: 'u1' }, items: [] }),
    fetchTopicDetail: async () => ({ topic: { id: 't1' }, items: [] }),
    fetchFeed: async () => ({ items: [] }),
    fetchMyContents: async () => ({ items: [] }),
    listDrafts: () => [],
    formatRelativeTime: () => '',
    toggleReaction: async () => ({}),
    toggleBookmark: async () => ({}),
    shrinkVisibility: async () => ({}),
    deletePost: async () => ({}),
    submitTopic: async () => ({}),
    toggleFollow: async () => ({}),
    FEED_FILTERS: [],
    TOPIC_CATEGORIES: [],
    previewPostImage() {},
    navigateTo() {},
    wx: { showToast() {} },
    ...services,
  });
  const context = Object.create(page);
  context.data = structuredClone(page.data);
  context.setData = (patch, callback) => {
    Object.assign(context.data, patch);
    if (callback) callback();
  };
  return context;
}

test('profile refresh wins over an older in-flight page append', async () => {
  const calls = [];
  const ctx = loadPage('../pages/community/profile/index.js', {
    fetchProfile: (...args) => { const request = deferred(); calls.push({ args, ...request }); return request.promise; },
  });
  Object.assign(ctx.data, { userId: 'u1', loading: false, list: [{ id: 'old-first' }], nextCursor: 'old-cursor', hasMore: true });

  const append = ctx.loadProfile({ append: true });
  const refresh = ctx.loadProfile();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[1], 'old-cursor');
  assert.equal(calls[1].args[1], '');

  calls[1].resolve({ user: { id: 'u1' }, items: [{ id: 'fresh-first' }], nextCursor: 'fresh-cursor' });
  await refresh;
  calls[0].resolve({ user: { id: 'u1' }, items: [{ id: 'stale-second' }], nextCursor: 'old-next' });
  await append;

  assert.deepEqual(Array.from(ctx.data.list, (item) => item.id), ['fresh-first']);
  assert.equal(ctx.data.nextCursor, 'fresh-cursor');
  assert.equal(ctx.data.loadingMore, false);
});

test('topic refresh wins over an older in-flight page append', async () => {
  const calls = [];
  const ctx = loadPage('../pages/community/topic/index.js', {
    fetchTopicDetail: (...args) => { const request = deferred(); calls.push({ args, ...request }); return request.promise; },
  });
  Object.assign(ctx.data, { id: 't1', topic: { id: 't1' }, loading: false, list: [{ id: 'old-first' }], nextCursor: 'old-cursor', hasMore: true });

  const append = ctx.loadDetail({ append: true });
  const refresh = ctx.loadDetail();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[1], 'old-cursor');
  assert.equal(calls[1].args[1], '');

  calls[1].resolve({ topic: { id: 't1' }, items: [{ id: 'fresh-first' }], nextCursor: 'fresh-cursor' });
  await refresh;
  calls[0].resolve({ topic: { id: 't1' }, items: [{ id: 'stale-second' }], nextCursor: 'old-next' });
  await append;

  assert.deepEqual(Array.from(ctx.data.list, (item) => item.id), ['fresh-first']);
  assert.equal(ctx.data.nextCursor, 'fresh-cursor');
  assert.equal(ctx.data.loadingMore, false);
});

test('silent feed refresh blocks pagination until its first page settles', async () => {
  const calls = [];
  const ctx = loadPage('../pages/home/index.js', {
    fetchFeed: (input) => { const request = deferred(); calls.push({ input, ...request }); return request.promise; },
  });
  Object.assign(ctx.data, { loading: false, list: [{ id: 'old-first' }], nextCursor: 'old-cursor', hasMore: true });

  const refresh = ctx.loadFeed({ silent: true });
  const append = ctx.loadFeed({ append: true });
  await append;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.cursor, '');
  calls[0].resolve({ items: [{ id: 'fresh-first' }], nextCursor: 'fresh-cursor' });
  await refresh;

  assert.deepEqual(Array.from(ctx.data.list, (item) => item.id), ['fresh-first']);
  assert.equal(ctx.data.nextCursor, 'fresh-cursor');
  assert.equal(ctx.feedFirstPageLoading, false);
});

test('silent My Content refresh blocks pagination until its first page settles', async () => {
  const calls = [];
  const ctx = loadPage('../pages/community/my-content/index.js', {
    fetchMyContents: (input) => { const request = deferred(); calls.push({ input, ...request }); return request.promise; },
  });
  Object.assign(ctx.data, {
    sessionReady: true, isGuest: false, tab: 'published', loading: false,
    list: [{ id: 'old-first' }], nextCursor: 'old-cursor', hasMore: true,
  });

  const refresh = ctx.loadTab({ silent: true });
  const append = ctx.loadTab({ append: true });
  await append;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.cursor, '');
  calls[0].resolve({ items: [{ id: 'fresh-first' }], nextCursor: 'fresh-cursor' });
  await refresh;
  await tick();

  assert.deepEqual(Array.from(ctx.data.list, (item) => item.id), ['fresh-first']);
  assert.equal(ctx.data.nextCursor, 'fresh-cursor');
  assert.equal(ctx.tabFirstPageLoading, false);
});
