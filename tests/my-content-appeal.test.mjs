import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'pages/community/my-content/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace(
    "import { deletePost, fetchMyContents, fetchPostDetail, toggleBookmark } from '~/services/posts';",
    'const deletePost = __deletePost; const fetchMyContents = __fetchMyContents; const fetchPostDetail = __fetchPostDetail; const toggleBookmark = __toggleBookmark;',
  )
  .replace("import { listDrafts, removeDraft } from '../drafts';", 'const listDrafts = __listDrafts; const removeDraft = __removeDraft;')
  .replace("import { formatRelativeTime } from '../format';", 'const formatRelativeTime = __formatRelativeTime;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const navigateTo = __navigateTo;');

let page;
let navigatedTo = '';
let detailCalls = 0;
const contentCalls = [];
const deleteCalls = [];
const modalCalls = [];
const toasts = [];
const app = {
  eventBus: { on() {}, off() {} },
  globalData: { session: { role: 'guest', memberStatus: 'none', user: { id: 'owner-a' }, club: null } },
};
vm.runInNewContext(source, {
  Page: (definition) => { page = definition; },
  getApp: () => app,
  wx: {
    showToast: (payload) => toasts.push(payload),
    showModal: (payload) => modalCalls.push(payload),
  },
  __deletePost: (...args) => { deleteCalls.push(args); return Promise.resolve(); },
  __fetchMyContents: (input) => { contentCalls.push(input); return Promise.resolve({ items: [{ id: 'p-removed', status: 'private', version: 3 }] }); },
  __fetchPostDetail: (...args) => {
    detailCalls += 1;
    return Promise.resolve({ id: 'p-removed', version: 3 });
  },
  __toggleBookmark: () => Promise.resolve(),
  __listDrafts: () => [],
  __removeDraft: () => {},
  __formatRelativeTime: () => '',
  __navigateTo: (url) => { navigatedTo = url; },
  encodeURIComponent,
});

const pageContext = {
  data: {
    list: [{ id: 'p-hidden', status: 'hidden', version: 7 }],
  },
  appealOpening: false,
};
await page.onAppealContent.call(pageContext, { currentTarget: { dataset: { id: 'p-hidden' } } });

assert.equal(detailCalls, 0);
assert.equal(navigatedTo, '/pages/community/appeals/index?postId=p-hidden&version=7');
assert.equal(pageContext.appealOpening, false);
assert.deepEqual(toasts, []);

const historyPage = {
  data: { ...page.data },
  setData(updates, callback) { Object.assign(this.data, updates); if (callback) callback(); },
};
Object.entries(page).forEach(([key, value]) => {
  if (key !== 'data' && typeof value === 'function') historyPage[key] = value;
});
await page.onLoad.call(historyPage, { clubId: 'club-removed', historyOnly: '1', tab: 'private' });
assert.equal(historyPage.data.historyOnly, true);
assert.deepEqual(Array.from(historyPage.data.tabs, (item) => item.value), ['published', 'pending', 'private']);
assert.equal(contentCalls[0].clubId, 'club-removed', 'removed-member history reads the requested club explicitly');
assert.equal(contentCalls[0].tab, 'private');
page.onPostTap.call(historyPage, { currentTarget: { dataset: { id: 'p-removed' } } });
assert.equal(navigatedTo, '/pages/community/post/index?id=p-removed&from=mine&clubId=club-removed&historyOnly=1');
await page.onDeleteContent.call(historyPage, { currentTarget: { dataset: { id: 'p-removed' } } });
assert.deepEqual(Array.from([detailCalls]), [1], 'owner history allows a scoped fresh detail read for deletion');
await modalCalls.at(-1).success({ confirm: true });
assert.deepEqual(JSON.parse(JSON.stringify(deleteCalls)), [['p-removed', 3, 'club-removed']]);
assert.equal(detailCalls, 1, 'the appeal check never fetched detail; only the owner history delete flow did');

const markup = readFileSync(join(ROOT, 'pages/community/my-content/index.wxml'), 'utf8');
assert.match(markup, /仅提供本人内容的查看和删除/);
assert.match(markup, /!historyOnly && item\.status === 'rejected'/);
assert.match(markup, /!historyOnly && \(item\.status === 'rejected' \|\| item\.status === 'hidden'\)/);

console.log('OK: hidden/rejected appeal entry uses the authenticated list version without reading detail');
