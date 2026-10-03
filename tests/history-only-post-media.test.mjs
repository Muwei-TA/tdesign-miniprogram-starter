import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'pages/community/post/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace(
    "import {\n  fetchPostDetail,\n  fetchComments,\n  submitComment,\n  COMMENT_LIMIT,\n  toggleReaction,\n  toggleBookmark,\n  toggleCommentReaction,\n  deleteComment,\n  shrinkVisibility,\n  deletePost,\n  submitReport,\n} from '~/services/posts';",
    'const { fetchPostDetail, fetchComments, submitComment, COMMENT_LIMIT, toggleReaction, toggleBookmark, toggleCommentReaction, deleteComment, shrinkVisibility, deletePost, submitReport } = __posts;',
  )
  .replace("import { previewPostImage } from '~/services/image-preview';", 'const { previewPostImage } = __preview;')
  .replace("import { createIdempotencyKey } from '~/utils/idempotency';", 'const { createIdempotencyKey } = __idempotency;')
  .replace("import { getCapabilities, getSession, scopedKey } from '~/services/session';", 'const { getCapabilities, getSession, scopedKey } = __session;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

test('history-only details omit media URLs while retaining readable text responses', async () => {
  let definition;
  const fetched = [];
  const app = {
    globalData: { session: { user: { id: 'user-1' } } },
    eventBus: { on() {}, off() {}, emit() {} },
  };
  vm.runInNewContext(source, {
    Page(page) { definition = page; },
    getApp: () => app,
    __posts: {
      async fetchPostDetail(id, clubId) {
        fetched.push(['detail', id, clubId]);
        return {
          id,
          kind: 'fragment',
          title: '本人历史内容',
          body: '仍可阅读的正文',
          paragraphs: ['仍可阅读的正文'],
          status: 'published',
          statusText: '',
          visibility: 'club',
          identityMode: 'named',
          commentsEnabled: true,
          version: 2,
          media: {
            type: 'image',
            images: ['https://signed.example/removed-member.jpg'],
            count: 1,
            video: null,
          },
          counters: { reactions: 0, comments: 1 },
          viewer: { isOwner: true, canComment: false, canShrinkVisibility: true, canDelete: true },
          author: { isAnonymous: false, userId: 'user-1', displayName: '读者' },
        };
      },
      async fetchComments(id, cursor, clubId) {
        fetched.push(['comments', id, cursor, clubId]);
        // The backend history-only contract filters to this user's own text responses.
        return {
          items: [{
            id: 'comment-1',
            body: '本人仍可阅读的文字回应',
            status: 'published',
            author: { isAnonymous: false, userId: 'user-1', displayName: '读者' },
            viewer: { canDelete: false, reacted: false },
            counters: { reactions: 0 },
            replies: [],
          }],
          nextCursor: null,
        };
      },
      async submitComment() {},
      COMMENT_LIMIT: 1000,
      async toggleReaction() {},
      async toggleBookmark() {},
      async toggleCommentReaction() {},
      async deleteComment() {},
      async shrinkVisibility() {},
      async deletePost() {},
      async submitReport() {},
    },
    __preview: { async previewPostImage() { throw new Error('history media must not be requested'); } },
    __idempotency: { createIdempotencyKey: () => 'test-key' },
    __session: {
      getCapabilities: () => ({}),
      getSession: () => app.globalData.session,
      scopedKey: (name) => `hg:user-1:none:${name}`,
    },
    __navigation: { navigateTo() {} },
    wx: { getStorageSync: () => ({}), showToast() {} },
    setTimeout,
    clearTimeout,
  });
  const page = Object.assign(Object.create(definition), {
    data: { ...definition.data, id: 'post-a', clubId: 'club-a', historyOnly: true },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  });

  await page.loadDetail();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(page.data.post.body, '仍可阅读的正文');
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.post.media)), { type: 'none', images: [], video: null, count: 0 });
  assert.equal(page.data.comments[0].author.userId, 'user-1');
  assert.equal(page.data.comments[0].body, '本人仍可阅读的文字回应');
  assert.deepEqual(fetched, [['detail', 'post-a', 'club-a'], ['comments', 'post-a', '', 'club-a']]);
});

console.log('OK: history-only posts keep text readable and never expose attachment URLs to the view');
