import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadPage(relativePath, replacements, globals = {}) {
  let definition;
  let source = readFileSync(join(ROOT, relativePath), 'utf8');
  replacements.forEach(([pattern, replacement]) => {
    source = source.replace(pattern, replacement);
  });
  vm.runInNewContext(source, {
    Page(value) {
      definition = value;
    },
    getApp: () => ({ setUnreadCount() {} }),
    wx: { stopPullDownRefresh() {} },
    setTimeout,
    clearTimeout,
    ...globals,
  });
  assert.ok(definition, `${relativePath} must register a Page definition`);
  return definition;
}

function pageContext(definition, patch = {}) {
  const context = {
    data: { ...definition.data, ...patch },
    setData(updates, callback) {
      Object.entries(updates).forEach(([path, value]) => {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => current[key], this.data);
        target[lastKey] = value;
      });
      if (callback) callback();
    },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') context[key] = value;
  });
  return context;
}

let topicCall = 0;
const topicsPage = loadPage(
  'pages/topics/index.js',
  [
    [
      "import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';",
      'const { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } = __topics;',
    ],
    ["import { getSession } from '~/services/session';", 'const { getSession } = __session;'],
    ["import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;'],
  ],
  {
    __topics: {
      async fetchTopics() {
        topicCall += 1;
        if (topicCall === 1) throw new Error('话题服务暂不可用');
        return { items: [{ id: 'topic-new' }] };
      },
      submitTopic() {},
      toggleFollow() {},
      TOPIC_CATEGORIES: [],
    },
    __session: { getSession: () => ({ memberStatus: 'active' }) },
    __navigation: { navigateTo() {} },
  },
);
const topics = pageContext(topicsPage, { list: [{ id: 'topic-old' }] });
await topicsPage.loadTopics.call(topics);
assert.deepEqual(topics.data.list.map((item) => item.id), ['topic-old']);
assert.equal(topics.data.stale, true);
assert.equal(topics.data.errorText, '话题服务暂不可用');
assert.equal(topics.data.loading, false);
await topicsPage.loadTopics.call(topics);
assert.deepEqual(topics.data.list.map((item) => item.id), ['topic-new']);
assert.equal(topics.data.stale, false);
assert.equal(topics.data.errorText, '');

let messageCall = 0;
const messagesPage = loadPage(
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
        messageCall += 1;
        if (messageCall === 1) throw new Error('消息服务暂不可用');
        return { items: [{ id: 'message-new' }] };
      },
      markAllRead() {},
    },
    __navigation: { navigateTo() {} },
  },
);
const messages = pageContext(messagesPage, { list: [{ id: 'message-old' }] });
await messagesPage.loadList.call(messages);
assert.deepEqual(messages.data.list.map((item) => item.id), ['message-old']);
assert.equal(messages.data.stale, true);
assert.equal(messages.data.errorText, '消息服务暂不可用');
assert.equal(messages.data.loading, false);
await messagesPage.loadList.call(messages);
assert.deepEqual(messages.data.list.map((item) => item.id), ['message-new']);
assert.equal(messages.data.stale, false);

let searchCall = 0;
const searchPage = loadPage(
  'pages/search/index.js',
  [
    [
      "import { search, fetchSuggestions } from '~/services/search';",
      'const { search, fetchSuggestions } = __search;',
    ],
    ["import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;'],
  ],
  {
    __search: {
      async search() {
        searchCall += 1;
        if (searchCall === 1) throw new Error('搜索服务暂不可用');
        if (searchCall === 2) return { items: [], stale: true };
        return { items: [{ id: 'result-new' }] };
      },
      fetchSuggestions() {},
    },
    __navigation: { navigateTo() {} },
  },
);
const searchContext = pageContext(searchPage, {
  keyword: '旧结果对应的词',
  results: [{ id: 'result-old' }],
  searched: true,
});
await searchPage.runSearch.call(searchContext);
assert.deepEqual(searchContext.data.results.map((item) => item.id), ['result-old']);
assert.equal(searchContext.data.stale, true);
assert.equal(searchContext.data.errorText, '搜索服务暂不可用');
assert.equal(searchContext.data.loading, false);

await searchPage.onRetry.call(searchContext);
assert.deepEqual(searchContext.data.results.map((item) => item.id), ['result-old']);
assert.equal(searchContext.data.stale, true);
assert.equal(searchContext.data.errorText, '这次搜索结果已过期，请重试');
assert.equal(searchContext.data.loading, false);

await searchPage.onRetry.call(searchContext);
assert.deepEqual(searchContext.data.results.map((item) => item.id), ['result-new']);
assert.equal(searchContext.data.stale, false);
assert.equal(searchContext.data.errorText, '');

for (const [pageName, className, wxmlPath] of [
  ['topics', 'hg-topics', 'pages/topics/index.wxml'],
  ['message', 'hg-message', 'pages/message/index.wxml'],
  ['search', 'hg-search', 'pages/search/index.wxml'],
]) {
  const wxml = readFileSync(join(ROOT, wxmlPath), 'utf8');
  assert.match(wxml, new RegExp(`wx:if="\\{\\{ stale \\}\\}" class="${className}__stale"`));
  assert.match(wxml, new RegExp(`class="${className}__retry" bindtap="onRetry"`));
  assert.match(wxml, /errorText && !stale/);
  assert.ok(wxml.indexOf(`${className}__stale`) < wxml.indexOf('wx:if="{{ list.length > 0 }}"') || pageName === 'search');
}

console.log('OK: topic, message, and search errors retain old results and expose retry until success');
