import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function createEventBus() {
  const listeners = new Map();
  return {
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    off(name, callback) {
      if (callback) listeners.get(name)?.delete(callback);
      else listeners.delete(name);
    },
    emit(name, value) {
      for (const callback of listeners.get(name) || []) callback(value);
    },
    count(name) {
      return (listeners.get(name) || new Set()).size;
    },
  };
}

let pageDefinition;
let session = { role: 'guest', memberStatus: 'none', user: null };
let topicFetches = 0;
let sessionReads = 0;
const modalCalls = [];
const navigations = [];
const app = { eventBus: createEventBus() };
const source = read('pages/topics/index.js')
  .replace(
    "import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';",
    'const { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } = __topics;',
  )
  .replace("import { getSession } from '~/services/session';", 'const { getSession } = __session;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

vm.runInNewContext(source, {
  Page(value) {
    pageDefinition = value;
  },
  getApp: () => app,
  __topics: {
    async fetchTopics() {
      topicFetches += 1;
      return { items: [] };
    },
    submitTopic() {},
    toggleFollow() {},
    TOPIC_CATEGORIES: [],
  },
  __session: {
    getSession() {
      sessionReads += 1;
      return session;
    },
  },
  __navigation: { navigateTo: (url) => navigations.push(url) },
  wx: {
    getWindowInfo: () => ({ windowHeight: 700, safeArea: { top: 20, bottom: 680 }, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 90 }),
    showModal(options) {
      modalCalls.push(options);
    },
    hideKeyboard() {},
    showToast() {},
  },
});

assert.ok(pageDefinition, 'topics page must register');

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
assert.equal(page.data.isMember, false, 'cold start may begin with a guest placeholder');
assert.equal(app.eventBus.count('session-changed'), 1, 'page subscribes to session changes');

session = { role: 'moderator', memberStatus: 'active', user: { id: 'moderator-1' } };
app.eventBus.emit('session-changed', session);
assert.equal(page.data.isMember, true, 'bootstrap session change promotes the page to member');

page.onCreateOpen();
assert.equal(page.data.createVisible, true, 'active member can open the topic editor');
assert.equal(modalCalls.length, 0, 'active member is not shown the membership gate');
page.onCreateClose();

page.setData({ isMember: false });
page.onCreateOpen();
assert.equal(page.data.createVisible, true, 'tap uses the current session even if the rendered flag is stale');
assert.equal(modalCalls.length, 0, 'latest active session bypasses stale guest UI state');
page.onCreateClose();

const fetchesBeforeShow = topicFetches;
sessionReads = 0;
page.onShow();
assert.equal(page.data.isMember, true, 'returning to the Tab syncs the current session cache');
assert.equal(sessionReads, 1, 'onShow reads the session cache once');
assert.equal(topicFetches, fetchesBeforeShow, 'onShow does not trigger a session or topics network refresh');

session = { role: 'guest', memberStatus: 'none', user: null };
app.eventBus.emit('session-changed', session);
assert.equal(page.data.isMember, false, 'logout or revoked membership clears member UI');
page.onCreateOpen();
assert.equal(page.data.createVisible, false, 'guest cannot open the editor');
assert.equal(modalCalls.length, 1, 'guest is shown the membership gate');
modalCalls[0].success({ confirm: true });
assert.deepEqual(navigations, ['/pages/community/join/index?from=topics']);

page.onUnload();
assert.equal(app.eventBus.count('session-changed'), 0, 'page unsubscribes when unloaded');
