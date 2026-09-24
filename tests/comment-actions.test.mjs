import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 运行真实详情页实现，只替换小程序 alias 与全局对象。
const postSource = readFileSync(join(ROOT, 'pages/community/post/index.js'), 'utf8')
  .replace(
    /import \{[\s\S]*?\} from '~\/services\/posts';/,
    'const { fetchPostDetail, fetchComments, submitComment, COMMENT_LIMIT, toggleReaction, toggleBookmark, toggleCommentReaction, deleteComment, shrinkVisibility, deletePost } = __posts;',
  )
  .replace("import { previewPostImage } from '~/services/image-preview';", 'const { previewPostImage } = __helpers;')
  .replace(
    "import { createIdempotencyKey } from '~/utils/idempotency';",
    "const createIdempotencyKey = (prefix) => prefix + '-test';",
  )
  .replace(
    /import \{ getCapabilities, getSession, scopedKey \} from '~\/services\/session';/,
    'const { getCapabilities, getSession, scopedKey } = __helpers;',
  )
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __helpers;');

const comment = (overrides = {}) => ({
  id: 'c1',
  author: { userId: 'u-1', displayName: '成员一', isAnonymous: false, alias: null, isAuthor: false },
  body: '一级回应',
  createdAtText: '刚刚',
  status: 'published',
  version: 1,
  counters: { reactions: 2 },
  viewer: { reacted: false, canDelete: true },
  replies: [],
  ...overrides,
});

const post = (overrides = {}) => ({
  id: 'post-1',
  version: 3,
  visibility: 'club',
  status: 'published',
  commentsEnabled: true,
  counters: { reactions: 0, comments: 2 },
  viewer: { canComment: true },
  ...overrides,
});

function createHarness(comments, { deleteResult, reactResult } = {}) {
  const calls = { react: [], delete: [], events: [], modals: [], toasts: [], modalPromises: [] };
  const app = {
    eventBus: {
      on() {},
      off() {},
      emit: (event, payload) => calls.events.push({ event, ...payload }),
    },
    globalData: {},
  };
  const wx = {
    showModal: (options) => {
      calls.modals.push(options);
      // 页面把删除逻辑写在 success 回调里；捕获其 Promise 供测试等待
      if (options.success) {
        calls.modalPromises.push(Promise.resolve().then(() => options.success({ confirm: true })));
      }
    },
    showToast: (options) => calls.toasts.push(options),
    pageScrollTo() {},
    getStorageSync: () => ({}),
    setStorageSync() {},
  };
  const posts = {
    fetchPostDetail: async () => post(),
    fetchComments: async () => ({ items: comments }),
    submitComment: async () => ({ state: 'published' }),
    COMMENT_LIMIT: 1000,
    toggleReaction: async () => {},
    toggleBookmark: async () => {},
    toggleCommentReaction: async (...args) => {
      calls.react.push(args);
      if (reactResult instanceof Error) throw reactResult;
      return { ok: true };
    },
    deleteComment: async (...args) => {
      calls.delete.push(args);
      if (deleteResult instanceof Error) throw deleteResult;
      return { ok: true };
    },
    shrinkVisibility: async () => {},
    deletePost: async () => {},
  };
  let page;
  vm.runInNewContext(postSource, {
    Page: (definition) => {
      page = definition;
    },
    getApp: () => app,
    wx,
    __posts: posts,
    __helpers: {
      previewPostImage() {},
      getCapabilities: () => ({}),
      getSession: () => ({ user: null }),
      scopedKey: (name) => 'test:' + name,
      navigateTo() {},
    },
  });
  const context = Object.create(page);
  context.data = { ...page.data, id: 'post-1', post: post(), comments };
  // 解析小程序 setData 的路径键（comments[0].viewer.reacted 等）
  context.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const path = key
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
      let target = context.data;
      for (let i = 0; i < path.length - 1; i += 1) target = target[path[i]];
      target[path[path.length - 1]] = value;
    }
  };
  return { context, calls, page, wx };
}

test('回应共鸣做乐观更新并在失败时回滚', async () => {
  const { context, calls } = createHarness([comment()]);
  await context.onCommentReact({ detail: { id: 'c1' } });

  assert.deepEqual(calls.react, [['post-1', 'c1', true]]);
  assert.equal(context.data.comments[0].viewer.reacted, true);
  assert.equal(context.data.comments[0].counters.reactions, 3);

  await context.onCommentReact({ detail: { id: 'c1' } });
  assert.deepEqual(calls.react[1], ['post-1', 'c1', false]);
  assert.equal(context.data.comments[0].viewer.reacted, false);
  assert.equal(context.data.comments[0].counters.reactions, 2);

  const failing = createHarness([comment()], { reactResult: new Error('网络不可用') });
  await failing.context.onCommentReact({ detail: { id: 'c1' } });
  assert.equal(failing.context.data.comments[0].viewer.reacted, false);
  assert.equal(failing.context.data.comments[0].counters.reactions, 2);
  assert.equal(failing.calls.toasts.length, 1);
});

test('删除有回复的已发布回应：调用服务端并本地降为墓碑', async () => {
  const item = comment({
    replies: [comment({ id: 'c2', body: '定向回复', viewer: { reacted: false, canDelete: false } })],
  });
  const { context, calls } = createHarness([item]);

  await context.onCommentDelete({ detail: { id: 'c1' } });
  await Promise.all(calls.modalPromises);

  assert.deepEqual(calls.delete, [['post-1', 'c1', 1]]);
  const tombstone = context.data.comments[0];
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.body, '这条回应已被删除。');
  assert.equal(tombstone.viewer.canDelete, false);
  assert.equal(tombstone.counters.reactions, 0);
  // 回复保留
  assert.equal(tombstone.replies.length, 1);
  assert.equal(tombstone.replies[0].body, '定向回复');
  // 原帖计数联动 + 事件通知列表刷新
  assert.equal(context.data.post.counters.comments, 1);
  assert.ok(calls.events.some((e) => e.event === 'post-changed' && e.action === 'comment'));
});

test('删除无回复的一级回应与删除回复都会整体移除', async () => {
  const noReplies = createHarness([comment()]);
  await noReplies.context.onCommentDelete({ detail: { id: 'c1' } });
  await Promise.all(noReplies.calls.modalPromises);
  assert.equal(noReplies.context.data.comments.length, 0);

  const withReply = createHarness([
    comment({ replies: [comment({ id: 'c2', viewer: { reacted: false, canDelete: true } })] }),
  ]);
  await withReply.context.onCommentDelete({ detail: { id: 'c2' } });
  await Promise.all(withReply.calls.modalPromises);
  assert.equal(withReply.context.data.comments[0].replies.length, 0);
  assert.equal(withReply.context.data.comments[0].id, 'c1');
});

test('删除墓碑的最后一条回复时，墓碑随之隐藏', async () => {
  const item = comment({
    deleted: true,
    body: '这条回应已被删除。',
    replies: [comment({ id: 'c2', viewer: { reacted: false, canDelete: true } })],
  });
  const { context, calls } = createHarness([item]);
  await context.onCommentDelete({ detail: { id: 'c2' } });
  await Promise.all(calls.modalPromises);

  assert.equal(context.data.comments.length, 0);
  // 被删的是回复本体，仍走服务端并广播计数变化
  assert.equal(calls.delete.length, 1);
  assert.equal(calls.events.length, 1);
});

test('本地待审占位直接移除，不调用服务端', async () => {
  const local = comment({ id: 'local-comment-1', status: 'pending', version: 1 });
  const { context, calls } = createHarness([local]);
  await context.onCommentDelete({ detail: { id: 'local-comment-1' } });
  await Promise.all(calls.modalPromises);

  assert.equal(context.data.comments.length, 0);
  assert.equal(calls.delete.length, 0);
  assert.equal(calls.events.length, 0);
});

test('非本人回应不弹删除确认', async () => {
  const others = comment({ viewer: { reacted: false, canDelete: false } });
  const { context, calls } = createHarness([others]);
  await context.onCommentDelete({ detail: { id: 'c1' } });

  assert.equal(calls.modals.length, 0);
  assert.equal(calls.delete.length, 0);
  assert.equal(context.data.comments.length, 1);
});

test('删除失败时保留原回应并提示', async () => {
  const { context, calls } = createHarness([comment()], { deleteResult: new Error('内容已被更新，请刷新后重试') });
  await context.onCommentDelete({ detail: { id: 'c1' } });
  await Promise.all(calls.modalPromises);

  assert.equal(context.data.comments.length, 1);
  assert.equal(context.data.comments[0].deleted, undefined);
  assert.equal(calls.toasts.length, 1);
});
