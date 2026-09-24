import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../pages/community/post/index.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const comment = (id = 'c1', extra = {}) => ({
  id, body: id, status: 'published', version: 2,
  author: { displayName: '成员', isAnonymous: false },
  counters: { reactions: 3 }, viewer: { reacted: false, canDelete: true }, replies: [], ...extra,
});
function harness(comments = [], services = {}) {
  const calls = { deletes: [], events: [], modals: [], toasts: [] };
  let page;
  const sandbox = {
    Page(value) { page = value; },
    getApp: () => ({ eventBus: { emit: (...args) => calls.events.push(args) } }),
    getSession: () => ({ user: { displayName: '我' } }), getCapabilities: () => ({}),
    scopedKey: (key) => key, navigateTo() {}, previewPostImage() {},
    createIdempotencyKey: () => 'test-key', COMMENT_LIMIT: 1000,
    fetchComments: async () => ({ items: [] }), fetchPostDetail: async () => ({}),
    submitComment: async () => ({ id: 'saved', state: 'published', comment: comment('saved') }),
    toggleCommentReaction: async () => ({ ok: true }),
    toggleReaction: async () => ({}), toggleBookmark: async () => ({}),
    shrinkVisibility: async () => ({}), deletePost: async () => ({}), submitReport: async () => ({}),
    deleteComment: async (...args) => { calls.deletes.push(args); },
    wx: {
      showModal: (options) => calls.modals.push(options),
      showToast: (options) => calls.toasts.push(options), pageScrollTo() {},
    }, ...services,
  };
  vm.runInNewContext(source, sandbox);
  const ctx = Object.create(page);
  ctx.data = { ...structuredClone(page.data), id: 'p1', comments,
    post: { id: 'p1', viewer: { isOwner: true }, counters: { comments: 3 } } };
  ctx.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let object = ctx.data;
      for (const part of parts.slice(0, -1)) object = object[part];
      object[parts.at(-1)] = value;
    }
  };
  const remove = async (id) => {
    ctx.onCommentDelete({ detail: { id } });
    const modal = calls.modals.pop();
    if (modal) await modal.success({ confirm: true });
  };
  return { ctx, calls, remove };
}

for (const state of ['published', 'pending']) {
  test(`F1 ${state}: replace temporary identity and delete using current server version`, async () => {
    const saved = comment('server-id', { status: state, version: 7 });
    const remote = new Map([['server-id', saved]]);
    const deletions = [];
    const { ctx, remove } = harness([], {
      submitComment: async () => ({ id: saved.id, state, comment: saved }),
      deleteComment: async (postId, id, version) => {
        deletions.push([postId, id, version]); remote.delete(id);
      },
    });
    await ctx.onCommentSubmit({ detail: { body: '回应' } });
    assert.equal(ctx.data.comments[0].id, 'server-id');
    await remove('server-id');
    assert.deepEqual(deletions, [['p1', 'server-id', 7]]);
    assert.equal(remote.size, 0);
    assert.equal(ctx.data.comments.length, 0);
  });
}

test('F1 submitting/uncertain placeholders cannot be deleted locally', async () => {
  const result = deferred();
  const { ctx, calls, remove } = harness([], { submitComment: () => result.promise });
  const submit = ctx.onCommentSubmit({ detail: { body: '回应' } });
  const id = ctx.data.comments[0].id;
  assert.equal(ctx.data.comments[0].viewer.canDelete, false);
  await remove(id);
  assert.equal(ctx.data.comments.length, 1);
  assert.equal(calls.deletes.length, 0);
  assert.equal(calls.toasts.length, 1);
  result.reject(new Error('timeout'));
  await submit;
  await remove(id);
  assert.equal(ctx.data.comments.length, 1);
});

test('F1 timeout retry reuses key and replaces, rather than duplicates, the saved reply', async () => {
  let attempt = 0;
  const keys = [];
  const saved = comment('saved-reply', { version: 4 });
  const { ctx, calls, remove } = harness([comment('parent')], {
    submitComment: async (id, input, key) => {
      keys.push(key);
      if (++attempt === 1) throw new Error('timeout after commit');
      return { id: saved.id, state: 'published', comment: saved };
    },
  });
  const event = { detail: { body: '回复', replyToId: 'parent' } };
  await ctx.onCommentSubmit(event);
  await ctx.onCommentSubmit(event);
  assert.equal(keys[0], keys[1]);
  assert.equal(ctx.data.comments[0].replies.length, 1);
  assert.equal(ctx.data.comments[0].replies[0].id, 'saved-reply');
  await remove('saved-reply');
  assert.deepEqual(calls.deletes, [['p1', 'saved-reply', 4]]);
});

test('rejected submission removes only its temporary placeholder', async () => {
  const { ctx } = harness([comment('old')], {
    submitComment: async () => ({ id: 'rejected', state: 'rejected', comment: comment('rejected', { status: 'rejected' }) }),
  });
  await ctx.onCommentSubmit({ detail: { body: '回应' } });
  assert.deepEqual(Array.from(ctx.data.comments, (c) => c.id), ['old']);
});

test('optimistic reaction succeeds and a failure rolls back', async () => {
  const { ctx } = harness([comment()]);
  await ctx.onCommentReact({ detail: { id: 'c1' } });
  assert.equal(ctx.data.comments[0].counters.reactions, 4);
  await ctx.onCommentReact({ detail: { id: 'c1' } });
  assert.equal(ctx.data.comments[0].counters.reactions, 3);
  const failing = harness([comment()], { toggleCommentReaction: async () => { throw new Error('offline'); } });
  await failing.ctx.onCommentReact({ detail: { id: 'c1' } });
  assert.equal(failing.ctx.data.comments[0].counters.reactions, 3);
  assert.equal(failing.ctx.data.comments[0].viewer.reacted, false);
});

test('F6 removing an earlier row cannot redirect a failed reaction rollback', async () => {
  const result = deferred();
  const { ctx } = harness([comment('a'), comment('b'), comment('c', { counters: { reactions: 9 } })],
    { toggleCommentReaction: () => result.promise });
  const react = ctx.onCommentReact({ detail: { id: 'b' } });
  ctx.removeCommentLocally('a');
  result.reject(new Error('offline'));
  await react;
  assert.equal(ctx.data.comments[0].id, 'b');
  assert.equal(ctx.data.comments[0].counters.reactions, 3);
  assert.equal(ctx.data.comments[1].counters.reactions, 9);
});

test('F6 a fresh server snapshot is not overwritten by an older failure', async () => {
  const result = deferred();
  const { ctx } = harness([comment('b')], {
    toggleCommentReaction: () => result.promise,
    fetchComments: async () => ({ items: [comment('b', { counters: { reactions: 12 }, viewer: { reacted: true } })] }),
  });
  const react = ctx.onCommentReact({ detail: { id: 'b' } });
  await ctx.loadComments();
  result.reject(new Error('offline'));
  await react;
  assert.equal(ctx.data.comments[0].counters.reactions, 12);
  assert.equal(ctx.data.comments[0].viewer.reacted, true);
});

test('F6 removed targets and deleted parent tombstones are not recreated by rollback', async () => {
  for (const replies of [[], [comment('reply')]]) {
    const result = deferred();
    const { ctx } = harness([comment('target', { replies })], { toggleCommentReaction: () => result.promise });
    const react = ctx.onCommentReact({ detail: { id: 'target' } });
    ctx.removeCommentLocally('target');
    result.reject(new Error('offline'));
    await react;
    if (replies.length) assert.equal(ctx.data.comments[0].counters.reactions, 0);
    else assert.equal(ctx.data.comments.length, 0);
  }
});

test('author deletion retains a tombstone until the last reply is removed', async () => {
  const { ctx, calls, remove } = harness([comment('parent', { replies: [comment('reply')] })]);
  await remove('parent');
  assert.equal(ctx.data.comments[0].deleted, true);
  assert.equal(ctx.data.comments[0].author.userId, null);
  assert.equal(ctx.data.comments[0].replies.length, 1);
  await remove('reply');
  assert.equal(ctx.data.comments.length, 0);
  assert.equal(calls.events.length, 2);
  assert.equal(ctx.data.post.counters.comments, 1);
});

test('non-authors cannot delete; failed deletion keeps the original row', async () => {
  const other = harness([comment('other', { viewer: { canDelete: false } })]);
  await other.remove('other');
  assert.equal(other.calls.modals.length, 0);
  assert.equal(other.calls.deletes.length, 0);
  const failed = harness([comment()], { deleteComment: async () => { throw new Error('version conflict'); } });
  await failed.remove('c1');
  assert.equal(failed.ctx.data.comments.length, 1);
  assert.equal(failed.ctx.data.comments[0].deleted, undefined);
});

test('F5 append merges repeated parents and replies without dropping earlier children', async () => {
  const pages = [
    { items: [comment('parent', { replies: [comment('r1')] })], nextCursor: 'next' },
    { items: [comment('parent', { replies: [comment('r1'), comment('r2')] })], nextCursor: null },
  ];
  const cursors = [];
  const { ctx } = harness([], { fetchComments: async (id, cursor) => { cursors.push(cursor); return pages.shift(); } });
  await ctx.loadComments();
  await ctx.loadComments({ append: true });
  assert.deepEqual(cursors, ['', 'next']);
  assert.equal(ctx.data.comments.length, 1);
  assert.deepEqual(Array.from(ctx.data.comments[0].replies, (r) => r.id), ['r1', 'r2']);
  assert.equal(ctx.data.commentsHasMore, false);
});

test('a pre-delete comments request cannot resurrect a successfully deleted row', async () => {
  const result = deferred();
  const { ctx, remove } = harness([comment()], { fetchComments: () => result.promise });
  const load = ctx.loadComments();
  await remove('c1');
  result.resolve({ items: [comment()] });
  await load;
  assert.equal(ctx.data.comments.length, 0);
  await tick();
});
