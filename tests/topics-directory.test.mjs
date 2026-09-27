import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

const serviceModule = { exports: {} };
const serviceCalls = [];
const serviceSource = read('services/topics.js')
  .replace(
    "import request, { withPath, withQuery } from '~/api/request';",
    'const { request, withPath, withQuery } = __api;',
  )
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace('export default ', 'module.exports.default = ')
  .concat('\nmodule.exports.fetchTopics = fetchTopics;');
vm.runInNewContext(serviceSource, {
  module: serviceModule,
  __api: {
    request(url) {
      serviceCalls.push({ type: 'request', url });
      return Promise.resolve({ items: [] });
    },
    withQuery(url, query) {
      serviceCalls.push({ type: 'query', url, query });
      return '/topics?directory-query';
    },
    withPath: (url) => url,
  },
  __endpoints: { topics: '/topics', topicDetail: '/topics/:id', topicFollow: '/topics/:id/follow' },
});

await serviceModule.exports.fetchTopics({ category: 'all', q: '  山茶  ', cursor: 'cursor-1', status: 'active' });
assert.deepEqual(plain(serviceCalls[0]), {
  type: 'query',
  url: '/topics',
  query: { category: '', cursor: 'cursor-1', q: '山茶', status: 'active' },
});
assert.deepEqual(plain(serviceCalls[1]), { type: 'request', url: '/topics?directory-query' });

let pageDefinition;
let submitTopic = async () => ({ duplicated: false, id: 'new-board', status: 'pending' });
const fetchCalls = [];
const modalCalls = [];
const toastCalls = [];
const navigations = [];
const listeners = new Map();
let session = { role: 'member', memberStatus: 'active', user: { id: 'member-1' } };
let resolveOldSearch;
const oldSearch = new Promise((resolve) => { resolveOldSearch = resolve; });
const app = {
  eventBus: {
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    off(name, callback) {
      if (callback) listeners.get(name)?.delete(callback);
      else listeners.delete(name);
    },
  },
};

const pageSource = read('pages/topics/index.js')
  .replace(
    "import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';",
    'const { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } = __topics;',
  )
  .replace("import { getSession } from '~/services/session';", 'const { getSession } = __session;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

vm.runInNewContext(pageSource, {
  Page(value) {
    pageDefinition = value;
  },
  getApp: () => app,
  __topics: {
    async fetchTopics(query) {
      fetchCalls.push({ ...query });
      if (query.q === 'old') return oldSearch;
      if (query.q === 'new' && query.cursor === 'cursor-new') {
        return { items: [{ id: 'new-page', title: '新词第二页', status: 'active' }], nextCursor: null };
      }
      if (query.q === 'new') {
        return { items: [{ id: 'new-first', title: '新词首项', status: 'active' }], nextCursor: 'cursor-new' };
      }
      return { items: [{ id: 'initial', title: '初始板块', status: 'active' }], nextCursor: 'cursor-initial' };
    },
    submitTopic(payload) {
      return submitTopic(payload);
    },
    toggleFollow: async () => {},
    TOPIC_CATEGORIES: [{ value: 'all', label: '全部' }, { value: 'life', label: '生活' }],
  },
  __session: { getSession: () => session },
  __navigation: { navigateTo: (url) => navigations.push(url) },
  setTimeout,
  clearTimeout,
  wx: {
    getWindowInfo: () => ({ windowHeight: 700, safeArea: { top: 20, bottom: 680 }, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 90 }),
    showModal(options) { modalCalls.push(options); },
    showToast(options) { toastCalls.push(options); },
    hideKeyboard() {},
    stopPullDownRefresh() {},
  },
});

assert.ok(pageDefinition, 'directory page must register');
const page = {
  data: { ...pageDefinition.data, form: { ...pageDefinition.data.form } },
  setData(patch, callback) {
    Object.entries(patch).forEach(([path, value]) => {
      const keys = path.split('.');
      const key = keys.pop();
      const target = keys.reduce((result, part) => result[part], this.data);
      target[key] = value;
    });
    if (callback) callback();
  },
  getTabBar: () => ({ setData() {} }),
};
Object.entries(pageDefinition).forEach(([key, value]) => {
  if (key !== 'data' && typeof value === 'function') page[key] = value;
});

page.onLoad();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(page.data.list.map((item) => item.id), ['initial']);

page.onSearchInput({ detail: { value: 'old' } });
const staleSearch = page.onSearchSubmit();
page.onSearchInput({ detail: { value: 'new' } });
resolveOldSearch({ items: [{ id: 'old-result', title: '旧词结果', status: 'active' }], nextCursor: null });
await staleSearch;
assert.deepEqual(plain(page.data.list), [], 'a response for an older search must not replace the new query');

await page.onSearchSubmit();
assert.deepEqual(page.data.list.map((item) => item.id), ['new-first']);
assert.equal(page.data.hasMore, true);
await page.onLoadMoreTap();
assert.deepEqual(fetchCalls.slice(-2), [
  { category: 'all', q: 'new', cursor: '' },
  { category: 'all', q: 'new', cursor: 'cursor-new' },
]);
assert.deepEqual(page.data.list.map((item) => item.id), ['new-first', 'new-page']);

page.setData({ createVisible: true, form: { title: 'Conflict board', description: '', category: 'life' }, canSubmit: true });
submitTopic = async () => {
  const error = new Error('已有社员提交了同名板块，请修改名称后重试。');
  error.kind = 'conflict';
  throw error;
};
await page.onCreateSubmit();
assert.equal(modalCalls.at(-1).title, '板块未提交');
assert.equal(modalCalls.at(-1).content, '已有社员提交了同名板块，请修改名称后重试。');
assert.equal(navigations.length, 0, 'a hidden pending duplicate must not navigate to an unreadable ID');
assert.equal(toastCalls.some((item) => item.title.includes('已提交')), false, 'a conflict must not look like a successful submission');

page.setData({ createVisible: true, form: { title: 'Archived board', description: '', category: 'life' }, canSubmit: true });
submitTopic = async () => ({ duplicated: true, id: 'archived-1', status: 'archived' });
await page.onCreateSubmit();
assert.equal(modalCalls.at(-1).confirmText, '查看板块', 'archived boards can be viewed but not joined for new posts');
modalCalls.at(-1).success({ confirm: true });
assert.deepEqual(navigations, ['/pages/community/topic/index?id=archived-1']);

page.onUnload();
console.log('OK: directory search uses q pagination, stale queries cannot win, and topic conflicts respect visibility/status');
