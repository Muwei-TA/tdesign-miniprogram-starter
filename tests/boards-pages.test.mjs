import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const pause = () => new Promise((resolve) => setImmediate(resolve));

function evaluatePage(source, imports, runtime) {
  let definition;
  let transformed = source;
  Object.entries(imports).forEach(([statement, replacement]) => {
    transformed = transformed.replace(statement, replacement);
  });
  vm.runInNewContext(transformed, {
    Page(value) {
      definition = value;
    },
    getApp: () => runtime.app,
    __boards: runtime.boards,
    __session: runtime.session,
    __navigation: runtime.navigation,
    __helpers: runtime.helpers,
    wx: runtime.wx,
    encodeURIComponent,
  });
  const page = Object.create(definition);
  page.data = { ...definition.data };
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

const navigations = [];
const toasts = [];
const modals = [];
const boardCalls = [];
const listeners = new Map();
let createResult = { id: 'new-board', status: 'pending' };
let createError = null;
const app = {
  eventBus: {
    on(name, callback) {
      listeners.set(name, callback);
    },
    off(name) {
      listeners.delete(name);
    },
  },
};
const directorySource = read('pages/community/boards/index.js');
const directory = evaluatePage(directorySource, {
  "import { fetchBoards, submitBoard } from '~/services/boards';": 'const { fetchBoards, submitBoard } = __boards;',
  "import { getSession } from '~/services/session';": 'const { getSession } = __session;',
  "import { navigateTo } from '~/utils/navigate';": 'const { navigateTo } = __navigation;',
}, {
  app,
  boards: {
    async fetchBoards(query) {
      boardCalls.push({ ...query });
      return {
        items: [
          { id: 'active-1', title: '夜读', status: 'active' },
          { id: 'pending-1', title: '不应公开', status: 'pending' },
        ],
        nextCursor: null,
      };
    },
    async submitBoard(payload) {
      if (createError) throw createError;
      boardCalls.push({ create: payload });
      return createResult;
    },
  },
  session: { getSession: () => ({ role: 'member', memberStatus: 'active' }) },
  navigation: { navigateTo: (url) => navigations.push(url) },
  wx: {
    showToast(options) { toasts.push(options); },
    showModal(options) { modals.push(options); },
    stopPullDownRefresh() {},
  },
});

directory.onLoad();
await pause();
assert.deepEqual(directory.data.list.map((item) => item.id), ['active-1']);
assert.deepEqual(boardCalls[0], { q: '', cursor: '', status: 'active' });
directory.onKeywordInput({ detail: { value: '  夜读  ' } });
directory.onSearch();
await pause();
assert.equal(boardCalls.at(-1).q, '夜读');
directory.onBoardTap({ currentTarget: { dataset: { id: 'active-1' } } });
assert.equal(navigations.at(-1), '/pages/community/board/index?id=active-1');

directory.onCreateTap();
directory.onTitleInput({ detail: { value: '林间共读' } });
directory.onDescriptionInput({ detail: { value: '记录每周读到的句子' } });
await directory.onCreateSubmit();
assert.deepEqual(JSON.parse(JSON.stringify(boardCalls.at(-1))), {
  create: { title: '林间共读', description: '记录每周读到的句子' },
});
assert.equal(directory.data.createdStatus, 'pending');
assert.equal(directory.data.createdDuplicate, false);
directory.onViewCreatedBoard();
assert.equal(navigations.at(-1), '/pages/community/board/index?id=new-board');

createResult = { duplicated: true, id: 'existing-board', status: 'active' };
directory.onCreateTap();
directory.onTitleInput({ detail: { value: '已存在' } });
await directory.onCreateSubmit();
assert.equal(directory.data.createdDuplicate, true);
assert.equal(directory.data.createdStatus, 'active');
assert.equal(toasts.at(-1).title, '已找到同名板块');
directory.onViewCreatedBoard();
assert.equal(navigations.at(-1), '/pages/community/board/index?id=existing-board');
directory.syncSession({ role: 'admin', memberStatus: 'active' });
directory.onAdminQueueTap();
assert.equal(navigations.at(-1), '/pages/admin/reviews/index');
createError = Object.assign(new Error('hidden resource'), { kind: 'conflict' });
directory.onCreateTap();
directory.onTitleInput({ detail: { value: '类似名称' } });
await directory.onCreateSubmit();
assert.match(modals.at(-1).content, /可能已经存在或正在审核/);
assert.doesNotMatch(modals.at(-1).content, /hidden resource|existing-board/);
directory.onUnload();

const previewCalls = [];
let boardResult = {
  board: { id: 'board-1', title: '夜读', description: '每周共读', status: 'active' },
  items: [{ id: 'post 1' }],
  nextCursor: 'post-next',
  canPost: true,
};
let detailError = null;
const detailSource = read('pages/community/board/index.js');
const detail = evaluatePage(detailSource, {
  "import { fetchBoardDetail } from '~/services/boards';": 'const { fetchBoardDetail } = __boards;',
  "import { previewPostImage } from '~/services/image-preview';": 'const { previewPostImage } = __helpers;',
  "import { getSession } from '~/services/session';": 'const { getSession } = __session;',
  "import { navigateTo } from '~/utils/navigate';": 'const { navigateTo } = __navigation;',
}, {
  app,
  boards: {
    async fetchBoardDetail(id, cursor) {
      boardCalls.push({ detailId: id, cursor });
      if (detailError) throw detailError;
      return boardResult;
    },
  },
  session: { getSession: () => ({ role: 'member', memberStatus: 'active' }) },
  navigation: { navigateTo: (url) => navigations.push(url) },
  helpers: { previewPostImage: (...args) => previewCalls.push(args) },
  wx: {
    showToast(options) { toasts.push(options); },
    showModal(options) { modals.push(options); },
    stopPullDownRefresh() {},
  },
});

detail.onLoad({ id: 'board-1' });
await pause();
assert.deepEqual(detail.data.list.map((item) => item.id), ['post 1']);
assert.equal(detail.data.canPost, true);
detail.onWrite();
assert.equal(navigations.at(-1), '/pages/release/index?boardId=board-1&boardTitle=%E5%A4%9C%E8%AF%BB');
detail.onTapBody({ detail: { id: 'post 1' } });
assert.equal(navigations.at(-1), '/pages/community/post/index?id=post%201&from=board');
detail.onTapMedia({ detail: { id: 'post-1', index: 2, type: 'image' } });
assert.deepEqual(previewCalls.at(-1), ['post-1', 2]);
detail.onTapMedia({ detail: { id: 'post-1', type: 'video' } });
assert.equal(navigations.at(-1), '/pages/community/post/index?id=post-1&from=board');
detail.onTapAuthor({ detail: { isAnonymous: true, userId: 'private-user' } });
assert.equal(modals.at(-1).title, '树洞身份');
detail.onTapAuthor({ detail: { isAnonymous: false, userId: 'member 1' } });
assert.equal(navigations.at(-1), '/pages/community/profile/index?userId=member%201');
detail.onTapTopic({ detail: { topicId: 'topic-9' } });
assert.equal(navigations.at(-1), '/pages/community/topic/index?id=topic-9');
detail.onTapBoard({ detail: { boardId: 'board-2' } });
assert.equal(navigations.at(-1), '/pages/community/board/index?id=board-2');

boardResult = {
  board: { id: 'board-1', title: '夜读', status: 'pending' },
  items: [],
  canPost: false,
};
await detail.loadDetail();
assert.equal(detail.data.canPost, false);
const navigationCount = navigations.length;
detail.onWrite();
assert.equal(navigations.length, navigationCount);
assert.match(toasts.at(-1).title, /等待审核/);

boardResult = {
  board: { id: 'board-1', title: '夜读', status: 'active' },
  items: [{ id: 'post 1' }],
  canPost: true,
};
await detail.loadDetail();
assert.equal(detail.data.list.length, 1);
detailError = new Error('network issue');
await detail.loadDetail();
assert.equal(detail.data.stale, true);
assert.equal(detail.data.board.title, '夜读');
assert.equal(detail.data.list.length, 1);
detail.onUnload();

const directoryWxml = read('pages/community/boards/index.wxml');
const detailWxml = read('pages/community/board/index.wxml');
assert.match(directoryWxml, /maxlength="50"/);
assert.match(directoryWxml, /isAdmin.*onAdminQueueTap/);
assert.match(directoryWxml, /没有已开放的板块/);
assert.match(detailSource, /boardId=\$\{encodeURIComponent\(this\.data\.id\)\}/);
assert.match(detailWxml, /bind:tapbody="onTapBody"/);
assert.match(detailWxml, /bind:tapmedia="onTapMedia"/);
assert.match(detailWxml, /bind:tapauthor="onTapAuthor"/);
assert.match(detailWxml, /bind:tapboard="onTapBoard"/);
assert.match(detailWxml, /bind:taptopic="onTapTopic"/);

console.log('OK: board directory visibility, duplicate feedback, detail post actions, and boardId compose flow');
