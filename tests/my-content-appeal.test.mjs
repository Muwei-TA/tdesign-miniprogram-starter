import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'pages/community/my-content/index.js'), 'utf8')
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
const toasts = [];
vm.runInNewContext(source, {
  Page: (definition) => { page = definition; },
  getApp: () => ({ eventBus: { on() {}, off() {} }, globalData: {} }),
  wx: { showToast: (payload) => toasts.push(payload) },
  __deletePost: () => Promise.resolve(),
  __fetchMyContents: () => Promise.resolve({ items: [] }),
  __fetchPostDetail: () => {
    detailCalls += 1;
    throw new Error('appeal entry must not read hidden detail');
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

console.log('OK: hidden/rejected appeal entry uses the authenticated list version without reading detail');
