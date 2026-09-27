import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = readFileSync(join(ROOT, 'pages/release/index.js'), 'utf8')
  .replace("import { submitPost } from '~/services/posts';", 'const { submitPost } = __posts;')
  .replace("import { fetchBoards } from '~/services/boards';", 'const { fetchBoards } = __boards;')
  .replace("import { saveDraft, getDraft, removeDraft } from './drafts';", 'const { saveDraft, getDraft, removeDraft } = __drafts;')
  .replace("import { bootstrapSession } from '~/services/session';", 'const { bootstrapSession } = __session;')
  .replace(
    "import {\n  IMAGE_STATUS,\n  LIMITS,\n  normalizeImageItem,\n  prepareImageFiles,\n  uploadImages,\n  validateImages,\n} from './uploads';",
    'const { IMAGE_STATUS, LIMITS, normalizeImageItem, prepareImageFiles, uploadImages, validateImages } = __uploads;',
  )
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

let pageDefinition;
const submittedPosts = [];
const savedDrafts = [];
const eventCalls = [];
const redirects = [];
const app = { eventBus: { on() {}, off() {}, emit: (event, data) => eventCalls.push({ event, data }) } };

vm.runInNewContext(pageSource, {
  Page(definition) { pageDefinition = definition; },
  getApp: () => app,
  __posts: {
    async submitPost(payload, idempotencyKey) {
      submittedPosts.push({ payload, idempotencyKey });
      return { id: `post-${submittedPosts.length}`, state: 'pending' };
    },
  },
  __boards: { fetchBoards: async () => ({ items: [], nextCursor: null }) },
  __drafts: {
    saveDraft(draft) {
      savedDrafts.push(draft);
      return { ...draft, id: draft.id || 'draft-1', idempotencyKey: draft.idempotencyKey || 'post-key-1' };
    },
    getDraft: () => null,
    removeDraft() {},
  },
  __session: { bootstrapSession: async () => null },
  __uploads: {
    IMAGE_STATUS: { VERIFIED: 'verified' },
    LIMITS: { imageCount: 9 },
    normalizeImageItem: (item) => item,
    prepareImageFiles: async (files) => files,
    uploadImages: async (images) => images,
    validateImages: () => ({ ok: true }),
  },
  __navigation: { navigateTo() {} },
  wx: {
    redirectTo: (options) => redirects.push(options),
    showToast() {},
    showModal() {},
  },
});

assert.ok(pageDefinition, 'release page must register');
const page = Object.assign(Object.create(pageDefinition), {
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  },
});

page.initializeEditor({ topicId: 'topic-1', topicTitle: '最近在读', boardId: 'board-1', boardTitle: '山茶读书会' });
assert.deepEqual(JSON.parse(JSON.stringify(page.data.topic)), { id: 'topic-1', title: '最近在读' });
assert.deepEqual(JSON.parse(JSON.stringify(page.data.board)), { id: 'board-1', title: '山茶读书会' });

page.data.body = '一段同时加入板块和话题的内容';
page.data.canPublish = true;
page.data.capabilities.publishing = true;
await page.onSubmit();
assert.equal(submittedPosts[0].payload.topicId, 'topic-1');
assert.equal(submittedPosts[0].payload.boardId, 'board-1');
assert.equal(savedDrafts[0].topic.id, 'topic-1');
assert.equal(savedDrafts[0].board.id, 'board-1');

page.onScopeChange({ detail: { value: 'private' } });
assert.equal(page.data.topic, null);
assert.equal(page.data.board, null);
await page.onSubmit();
assert.equal(submittedPosts[1].payload.topicId, '');
assert.equal(submittedPosts[1].payload.boardId, '');
assert.equal(redirects.length, 2);

console.log('OK: release keeps boardId and topicId independent and clears both for private posts');
