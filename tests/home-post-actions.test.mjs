import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPageModule } from './helpers/page-module-loader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const homeFeed = await loadPageModule(new URL('../pages/home/feed.js', import.meta.url), ['createHomeFeed']);
const homePostActions = await loadPageModule(new URL('../pages/home/post-actions.js', import.meta.url), ['createHomePostActions']);
const homeWxml = readFileSync(join(ROOT, 'pages/home/index.wxml'), 'utf8');
const postCardWxml = readFileSync(join(ROOT, 'components/post-card/index.wxml'), 'utf8');
const postCardStyles = readFileSync(join(ROOT, 'components/post-card/index.less'), 'utf8');
const postServiceSource = readFileSync(join(ROOT, 'services/posts.js'), 'utf8');
const postCardSource = readFileSync(join(ROOT, 'components/post-card/index.js'), 'utf8');
const homeSource = readFileSync(join(ROOT, 'pages/home/index.js'), 'utf8')
  .replace(
    // \r? 兼容 Windows 检出的 CRLF 工作副本，否则导入块剥不掉会导致 vm 报 import 语法错误
    /import \{[\s\S]*?FEED_FILTERS,\r?\n\} from '~\/services\/posts';/,
    'const { fetchFeed, toggleReaction, toggleBookmark, shrinkVisibility, deletePost, FEED_FILTERS } = __posts;',
  )
  .replace("import { fetchBoards } from '~/services/boards';", 'const { fetchBoards } = __boards;')
  .replace("import { previewPostImage } from '~/services/image-preview';", 'const { previewPostImage } = __helpers;')
  .replace(
    "import { getCapabilities, getSession } from '~/services/session';",
    'const { getCapabilities, getSession } = __helpers;',
  )
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __helpers;')
  .replace("import { createHomeFeed } from './feed';", 'const { createHomeFeed } = __homeFeed;')
  .replace("import { createHomePostActions } from './post-actions';", 'const { createHomePostActions } = __homePostActions;');

const post = (overrides = {}) => ({
  id: 'post-1',
  version: 4,
  visibility: 'club',
  status: 'published',
  author: { isAnonymous: true },
  media: { type: 'none' },
  viewer: { isOwner: true, canDelete: true, canShrinkVisibility: true },
  ...overrides,
});

function createHarness(item, {
  deleteResult = Promise.resolve(),
  shrinkResult = Promise.resolve(),
  boardsResult = { items: [] },
} = {}) {
  const calls = {
    delete: [], shrink: [], fetch: 0, feedRequests: [], boards: [], navigations: [], unreadRefreshes: 0,
    events: [], modals: [], actionSheets: [], toasts: [],
  };
  const app = {
    eventBus: {
      on() {},
      off() {},
      emit: (event, payload) => calls.events.push({ event, ...payload }),
    },
    globalData: { session: { role: 'member', memberStatus: 'active' } },
    refreshUnreadCount: () => {
      calls.unreadRefreshes += 1;
      return Promise.resolve();
    },
  };
  const wx = {
    showActionSheet: (options) => calls.actionSheets.push(options),
    showModal: (options) => calls.modals.push(options),
    showToast: (options) => calls.toasts.push(options),
  };
  const posts = {
    FEED_FILTERS: [{ value: 'all', label: '全部' }],
    fetchFeed: async (input) => {
      calls.fetch += 1;
      calls.feedRequests.push(input);
      return { items: [item] };
    },
    toggleReaction: async () => {},
    toggleBookmark: async () => {},
    shrinkVisibility: async (...args) => {
      calls.shrink.push(args);
      if (shrinkResult instanceof Error) throw shrinkResult;
      return shrinkResult;
    },
    deletePost: async (...args) => {
      calls.delete.push(args);
      if (deleteResult instanceof Error) throw deleteResult;
      return deleteResult;
    },
  };
  const boards = {
    fetchBoards: async (options) => {
      calls.boards.push(options);
      return typeof boardsResult === 'function' ? boardsResult(options) : boardsResult;
    },
  };
  let page;
  vm.runInNewContext(homeSource, {
    Page: (definition) => {
      page = definition;
    },
    getApp: () => app,
    wx,
    __posts: posts,
    __boards: boards,
    __homeFeed: homeFeed,
    __homePostActions: homePostActions,
    __helpers: {
      previewPostImage() {},
      getCapabilities: () => ({ publicScope: true }),
      getSession: () => ({ memberStatus: 'active' }),
      navigateTo: (url) => calls.navigations.push(url),
    },
  });
  const context = Object.create(page);
  context.data = { ...page.data, list: [item], loading: false };
  context.setData = (patch, callback) => {
    Object.assign(context.data, patch);
    if (callback) callback();
  };
  return { context, calls, page, wx };
}

function runPostCardObserver(value, mode = 'feed', canInteract = true) {
  let definition;
  vm.runInNewContext(postCardSource, {
    Component: (component) => {
      definition = component;
    },
  });
  const context = {
    data: { post: value, showActions: true, mode, canInteract },
    setData: (patch) => Object.assign(context.data, patch),
  };
  definition.observers['post, showActions, mode, canInteract'].call(context);
  return context.data;
}

assert.match(homeWxml, /bind:more="onMore"/);
assert.match(homeWxml, /recommendationCards\.length > 0/);
assert.match(homeWxml, /bindtap="onMoreRecommendations"/);
assert.match(homeWxml, /推荐板块/);
assert.match(homeWxml, /查看更多板块/);
assert.match(homeWxml, /wx:for-item="board"/);
assert.match(homeWxml, /data-id="\{\{ board\.id \}\}"/);
assert.match(homeWxml, /bindtap="onRecommendationTap"/);
assert.match(homeWxml, /catchtap="onRecommendationOpen"/);
assert.match(homeWxml, /selectedBoardId === board\.id/);
assert.match(homeWxml, /bind:tapboard="onTapBoard"/);
assert.doesNotMatch(homeWxml, /weekPrompt|本周共写/);
assert.doesNotMatch(homeWxml, /留一盏灯|给每一种表达|先选谁能看见|找回一句话/);
assert.match(homeWxml, /class="hg-home__feed-heading"[\s\S]*?<text>帖子<\/text>/);
assert.doesNotMatch(postServiceSource, /value: '(?:life|inspiration|article|video|awaiting_reply)'/);
assert.match(postServiceSource, /if \(boardId\) query\.boardId = boardId/);
assert.match(postCardWxml, /hg-post__content--feed/);
assert.match(postCardStyles, /flex-direction:\s*column-reverse/);

const recommendationHarness = createHarness(post(), {
  boardsResult: {
    items: [
      { id: 'board-1', title: '一', status: 'active' },
      { id: 'board-pending', title: '待审', status: 'pending' },
      { id: 'board-2', title: '二', status: 'active' },
      { id: 'board-archived', title: '归档', status: 'archived' },
      { id: 'board-3', title: '三', status: 'active' },
      { id: 'board-4', title: '四', status: 'active' },
      { id: 'board-5', title: '五', status: 'active' },
      { id: 'board-6', title: '六', status: 'active' },
      { id: 'board-7', title: '七', status: 'active' },
      { id: 'board-8', title: '八', status: 'active' },
      { id: 'board-9', title: '九', status: 'active' },
      { id: 'board-10', title: '十', status: 'active' },
    ],
  },
});
await recommendationHarness.context.loadRecommendations();
assert.deepEqual(JSON.parse(JSON.stringify(recommendationHarness.calls.boards[0])), { status: 'active' });
assert.deepEqual(
  Array.from(recommendationHarness.context.data.recommendationCards, (card) => card.items.map((board) => board.id)),
  [
    ['board-1', 'board-2', 'board-3'],
    ['board-4', 'board-5', 'board-6'],
    ['board-7', 'board-8', 'board-9'],
  ],
);
assert.deepEqual(
  Array.from(recommendationHarness.context.data.filters, (filter) => filter.value),
  ['all', 'board-1', 'board-2', 'board-3', 'board-4', 'board-5', 'board-6', 'board-7', 'board-8', 'board-9'],
);
const requestCountBeforeFirstShow = recommendationHarness.calls.boards.length;
await recommendationHarness.context.onShow();
assert.equal(recommendationHarness.calls.boards.length, requestCountBeforeFirstShow);
await recommendationHarness.context.onShow();
assert.equal(recommendationHarness.calls.boards.length, requestCountBeforeFirstShow + 1);
assert.equal(recommendationHarness.calls.unreadRefreshes, 1);
recommendationHarness.context.onRecommendationTap({ currentTarget: { dataset: { id: 'board-1' } } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(recommendationHarness.context.data.selectedBoardId, 'board-1');
assert.equal(recommendationHarness.calls.feedRequests.at(-1).boardId, 'board-1');
assert.equal(recommendationHarness.calls.feedRequests.at(-1).cursor, '');
recommendationHarness.context.onFilterTap({ currentTarget: { dataset: { value: 'all' } } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(recommendationHarness.context.data.selectedBoardId, '');
assert.equal(recommendationHarness.calls.feedRequests.at(-1).boardId, '');
recommendationHarness.context.data.nextCursor = 'old-cursor';
recommendationHarness.context.data.hasMore = true;
recommendationHarness.context.onFilterTap({ currentTarget: { dataset: { value: 'board-2' } } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(recommendationHarness.context.data.selectedBoardId, 'board-2');
assert.equal(recommendationHarness.calls.feedRequests.at(-1).cursor, '');
assert.equal(recommendationHarness.context.data.nextCursor, null);
recommendationHarness.context.onRecommendationOpen({ currentTarget: { dataset: { id: 'board-1' } } });
assert.equal(
  recommendationHarness.calls.navigations.at(-1),
  '/pages/community/board/index?id=board-1',
);
recommendationHarness.context.onMoreRecommendations();
assert.equal(recommendationHarness.calls.navigations.at(-1), '/pages/community/boards/index');
recommendationHarness.context.onTapTopic({ detail: { topicId: 'topic-1' } });
assert.equal(recommendationHarness.calls.navigations.at(-1), '/pages/community/topic/index?id=topic-1');
recommendationHarness.context.onTapBoard({ detail: { boardId: 'board-1' } });
assert.equal(recommendationHarness.calls.navigations.at(-1), '/pages/community/board/index?id=board-1');

const emptyRecommendationHarness = createHarness(post(), {
  boardsResult: { items: [{ id: 'board-pending', status: 'pending' }] },
});
emptyRecommendationHarness.context.data.selectedBoardId = 'board-retired';
await emptyRecommendationHarness.context.loadRecommendations();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(Array.from(emptyRecommendationHarness.context.data.recommendationCards), []);
assert.equal(emptyRecommendationHarness.context.data.recommendationState, 'empty');
assert.deepEqual(
  JSON.parse(JSON.stringify(emptyRecommendationHarness.context.data.filters)),
  [{ value: 'all', label: '全部' }],
);
assert.equal(emptyRecommendationHarness.context.data.selectedBoardId, '');
assert.equal(emptyRecommendationHarness.calls.feedRequests.at(-1).boardId, '');

let resolveOldSessionBoards;
const sessionRaceHarness = createHarness(post(), {
  boardsResult: () => new Promise((resolve) => { resolveOldSessionBoards = resolve; }),
});
const oldSessionLoad = sessionRaceHarness.context.loadRecommendations({ memberStatus: 'active' });
await sessionRaceHarness.context.loadRecommendations({ memberStatus: 'removed' });
resolveOldSessionBoards({ items: [{ id: 'stale-board', status: 'active' }] });
await oldSessionLoad;
assert.deepEqual(Array.from(sessionRaceHarness.context.data.recommendationCards), []);
assert.equal(sessionRaceHarness.context.data.recommendationState, 'guest');
assert.deepEqual(
  JSON.parse(JSON.stringify(sessionRaceHarness.context.data.filters)),
  [{ value: 'all', label: '全部' }],
);

const anonymousOwner = runPostCardObserver(
  post({
    visibility: 'private',
    status: 'pending',
    viewer: { isOwner: true, canDelete: true, canShrinkVisibility: false },
  }),
);
assert.equal(anonymousOwner.showMoreActions, true);
assert.equal(anonymousOwner.showInteractions, false);

const otherAuthor = runPostCardObserver(
  post({
    viewer: { isOwner: false, canDelete: false, canShrinkVisibility: false },
  }),
);
assert.equal(otherAuthor.showMoreActions, false);

const articleWithoutComments = runPostCardObserver(
  post({ viewer: { isOwner: false, canDelete: false, canShrinkVisibility: false, canComment: false } }),
  'article',
  false,
);
assert.equal(articleWithoutComments.showComments, false);
assert.equal(articleWithoutComments.showMemberActions, false);
const articleWithComments = runPostCardObserver(
  post({
    viewer: { isOwner: false, canDelete: false, canShrinkVisibility: false, canComment: false },
    counters: { comments: 3 },
  }),
  'article',
  false,
);
assert.equal(articleWithComments.showComments, true);
assert.equal(articleWithComments.showMemberActions, false);

const privatePost = post({
  visibility: 'private',
  viewer: { isOwner: true, canDelete: true, canShrinkVisibility: false },
});
const privateHarness = createHarness(privatePost);
privateHarness.context.onMore({ detail: { id: privatePost.id } });
assert.deepEqual(Array.from(privateHarness.calls.actionSheets[0].itemList), ['删除']);
privateHarness.calls.actionSheets[0].success({ tapIndex: 0 });
assert.equal(privateHarness.calls.modals[0].title, '删除这条内容');
await privateHarness.calls.modals[0].success({ confirm: false });
assert.deepEqual(privateHarness.calls.delete, []);
assert.equal(privateHarness.context.data.list.length, 1);

const clubPost = post({ visibility: 'club' });
const clubHarness = createHarness(clubPost);
clubHarness.context.onMore({ detail: { id: clubPost.id } });
assert.deepEqual(Array.from(clubHarness.calls.actionSheets[0].itemList), ['缩小可见范围', '删除']);
clubHarness.calls.actionSheets[0].success({ tapIndex: 0 });
assert.equal(clubHarness.context.data.scopeVisible, true);
clubHarness.context.onScopeChange({ detail: { value: 'public' } });
assert.deepEqual(clubHarness.calls.shrink, []);
assert.match(clubHarness.calls.toasts.at(-1).title, /更小/);

clubHarness.context.onMore({ detail: { id: clubPost.id } });
clubHarness.calls.actionSheets.at(-1).success({ tapIndex: 0 });
clubHarness.context.onScopeChange({ detail: { value: 'private' } });
await clubHarness.calls.modals.at(-1).success({ confirm: false });
assert.deepEqual(clubHarness.calls.shrink, []);
assert.equal(clubHarness.context.data.list.length, 1);

clubHarness.context.onMore({ detail: { id: clubPost.id } });
clubHarness.calls.actionSheets.at(-1).success({ tapIndex: 0 });
clubHarness.context.onScopeChange({ detail: { value: 'private' } });
clubHarness.context.onScopeClose();
await clubHarness.calls.modals.at(-1).success({ confirm: true });
assert.deepEqual(clubHarness.calls.shrink, [['post-1', 'private', 4]]);
assert.equal(clubHarness.context.data.list.length, 0);
assert.equal(clubHarness.calls.events.at(-1).action, 'visibility');

for (const target of ['club', 'private']) {
  const publicPost = post({ visibility: 'public' });
  const publicHarness = createHarness(publicPost);
  publicHarness.context.onMore({ detail: { id: publicPost.id } });
  publicHarness.calls.actionSheets[0].success({ tapIndex: 0 });
  publicHarness.context.onScopeChange({ detail: { value: target } });
  await publicHarness.calls.modals[0].success({ confirm: true });
  assert.equal(publicHarness.calls.shrink[0][1], target);
}

const failedScopePost = post({ visibility: 'club' });
const failedScopeHarness = createHarness(failedScopePost, { shrinkResult: new Error('scope denied') });
failedScopeHarness.context.onMore({ detail: { id: failedScopePost.id } });
failedScopeHarness.calls.actionSheets[0].success({ tapIndex: 0 });
failedScopeHarness.context.onScopeChange({ detail: { value: 'private' } });
await failedScopeHarness.calls.modals[0].success({ confirm: true });
assert.equal(failedScopeHarness.context.data.list.length, 1);
assert.match(failedScopeHarness.calls.toasts.at(-1).title, /scope denied/);

const deletePostFixture = post();
const deleteHarness = createHarness(deletePostFixture);
deleteHarness.context.onMore({ detail: { id: deletePostFixture.id } });
deleteHarness.calls.actionSheets[0].success({ tapIndex: 1 });
await deleteHarness.calls.modals[0].success({ confirm: true });
assert.deepEqual(deleteHarness.calls.delete, [['post-1', 4]]);
assert.equal(deleteHarness.context.data.list.length, 0);
assert.equal(deleteHarness.calls.events.at(-1).action, 'delete');

const invalidVersionPost = post({ version: '4' });
const invalidVersionHarness = createHarness(invalidVersionPost);
invalidVersionHarness.context.onMore({ detail: { id: invalidVersionPost.id } });
invalidVersionHarness.calls.actionSheets[0].success({ tapIndex: 1 });
assert.deepEqual(invalidVersionHarness.calls.delete, []);
assert.equal(invalidVersionHarness.calls.fetch, 1);

const failedPost = post();
const failedHarness = createHarness(failedPost, { deleteResult: new Error('server denied') });
failedHarness.context.onMore({ detail: { id: failedPost.id } });
failedHarness.calls.actionSheets[0].success({ tapIndex: 1 });
await failedHarness.calls.modals[0].success({ confirm: true });
assert.equal(failedHarness.context.data.list.length, 1);
assert.match(failedHarness.calls.toasts.at(-1).title, /server denied/);

console.log(
  'OK: feed post actions are owner-gated, direction-limited, confirmed, versioned, and reflected in the list',
);
