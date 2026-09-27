import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = (value) => JSON.parse(JSON.stringify(value));

const serviceSource = readFileSync(join(ROOT, 'pages/admin/moderation.js'), 'utf8')
  .replace("import request, { withPath, withQuery } from '~/api/request';", 'const request = __request; const withPath = __withPath; const withQuery = __withQuery;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'const __default = {');

const calls = [];
const endpoints = {
  adminQueue: '/admin/queues/:queue',
  adminDecision: '/admin/reviews/:id/decision',
  adminCommentDecision: '/admin/comments/:id/decision',
  adminMemberDecision: '/admin/members/applications/:id',
};
const withPath = (template, params = {}) => Object.keys(params).reduce(
  (url, key) => url.replace(`:${key}`, encodeURIComponent(params[key])),
  template,
);
const withQuery = (url, query = {}) => {
  const pairs = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return pairs.length ? `${url}?${pairs.join('&')}` : url;
};
const request = (url, options = {}) => {
  calls.push({ url, options });
  return Promise.resolve({
    items: [
      {
        id: 'p-1',
        queue: 'content',
        title: '待审核内容',
        summary: '摘要',
        submittedAtText: '刚刚',
        statusText: '等待审核',
        assetIds: ['a-1'],
        visibility: 'club',
        isAnonymous: true,
        ownerId: 'must-not-render',
        reporterId: 'must-not-render',
        mappings: [{ alias: 'secret', userId: 'u-secret' }],
      },
    ],
    nextCursor: 'next',
  });
};

const module = { exports: {} };
vm.runInNewContext(
  `${serviceSource}\nmodule.exports = { QUEUES, QUEUE_LABELS, ACTIONS_BY_QUEUE, getQueueActions, normalizeQueueItem, fetchQueue, submitDecision, decideComment, decideMembership, decideTopic, decideReport, decideCollection };`,
  {
    module,
    exports: module.exports,
    __request: request,
    __withPath: withPath,
    __withQuery: withQuery,
    __endpoints: endpoints,
    encodeURIComponent,
  },
);

const moderation = module.exports;

assert.deepEqual(plain(moderation.QUEUES.map((queue) => queue.value)), ['content', 'comment', 'topic', 'board', 'member', 'report', 'collection']);
assert.equal(moderation.ACTIONS_BY_QUEUE.report.find((action) => action.key === 'keep').requiresReason, true);
assert.equal(moderation.ACTIONS_BY_QUEUE.content.find((action) => action.key === 'approve').requiresReason, false);
assert.equal(moderation.ACTIONS_BY_QUEUE.comment.find((action) => action.key === 'reject').requiresReason, true);
assert.deepEqual(
  plain(moderation.ACTIONS_BY_QUEUE.board.map((action) => [action.key, action.requiresReason])),
  [['approve', false], ['reject', true]],
  'board review actions are independent from the topic archive workflow',
);
assert.equal(moderation.ACTIONS_BY_QUEUE.collection.some((action) => action.key === 'reveal'), false);

const item = moderation.normalizeQueueItem({
  id: 'r-1',
  queue: 'report',
  title: '内容被举报',
  summary: '举报理由',
  reporterId: 'hidden',
  ownerId: 'hidden',
  mappings: [{ alias: 'hidden', userId: 'hidden' }],
}, 'report');
assert.deepEqual(plain(item), {
  id: 'r-1',
  queue: 'report',
  queueLabel: '举报',
  title: '内容被举报',
  summary: '举报理由',
  submittedAtText: '',
  statusText: '',
  version: null,
  actions: plain(moderation.ACTIONS_BY_QUEUE.report),
  isAnonymous: false,
  assetIds: [],
  targetType: '',
  targetId: '',
});
assert.equal(Object.prototype.hasOwnProperty.call(item, 'reporterId'), false);
assert.equal(Object.prototype.hasOwnProperty.call(item, 'mappings'), false);

const commentItem = moderation.normalizeQueueItem({
  id: 'c-1',
  queue: 'comment',
  comment: '回应正文',
  title: '回应',
  summary: '回应正文',
  postId: 'p-1',
  version: 2,
  isAnonymous: true,
  ownerId: 'secret',
  mappings: [{ userId: 'secret' }],
}, 'comment');
assert.deepEqual(plain(commentItem), {
  id: 'c-1',
  queue: 'comment',
  queueLabel: '回应',
  title: '回应',
  summary: '回应正文',
  submittedAtText: '',
  statusText: '',
  version: 2,
  actions: plain(moderation.ACTIONS_BY_QUEUE.comment),
  isAnonymous: true,
  assetIds: [],
  comment: '回应正文',
  postId: 'p-1',
});
assert.equal(Object.prototype.hasOwnProperty.call(commentItem, 'ownerId'), false);
assert.equal(Object.prototype.hasOwnProperty.call(commentItem, 'mappings'), false);

const boardItem = moderation.normalizeQueueItem({
  id: 'b-1',
  title: '山茶读书会',
  summary: '每周共读与交流',
  status: 'pending',
  version: 4,
  ownerId: 'must-not-render',
}, 'board');
assert.equal(boardItem.queue, 'board');
assert.equal(boardItem.queueLabel, '板块');
assert.equal(boardItem.version, 4);
assert.deepEqual(plain(boardItem.actions.map((action) => action.key)), ['approve', 'reject']);
assert.equal(Object.prototype.hasOwnProperty.call(boardItem, 'ownerId'), false);

const queue = await moderation.fetchQueue({ queue: 'content', cursor: 'cursor-1' });
assert.equal(calls[0].url, '/admin/queues/content?cursor=cursor-1');
assert.equal(queue.items[0].isAnonymous, true);
assert.equal(Object.prototype.hasOwnProperty.call(queue.items[0], 'ownerId'), false);
assert.equal(Object.prototype.hasOwnProperty.call(queue.items[0], 'reporterId'), false);

await moderation.submitDecision('p-1', { decision: 'reject', reason: '需要补充来源', expectedVersion: 3 });
assert.deepEqual(plain(calls[1]), {
  url: '/admin/reviews/p-1/decision',
  options: { method: 'POST', data: { decision: 'reject', reason: '需要补充来源', expectedVersion: 3 } },
});
await moderation.decideTopic('t-1', { decision: 'archive', reason: '已过活动期' });
await moderation.decideMembership('m-1', { decision: 'reject', reason: '信息不足' });
await moderation.decideReport('r-1', { decision: 'hide', reason: '需要进一步核查' });
await moderation.decideCollection('c-1', { decision: 'skip', reason: '本期范围已满' });
await moderation.decideComment('comment-1', { decision: 'reject', reason: '请补充表达', expectedVersion: 2 });
assert.deepEqual(calls.slice(2).map((call) => call.url), [
  '/admin/topics/t-1/decision',
  '/admin/members/applications/m-1',
  '/admin/reports/r-1/decision',
  '/admin/collections/c-1/decision',
  '/admin/comments/comment-1/decision',
]);
assert.deepEqual(plain(calls[6]), {
  url: '/admin/comments/comment-1/decision',
  options: { method: 'POST', data: { decision: 'reject', reason: '请补充表达', expectedVersion: 2 } },
});

const transportSource = readFileSync(join(ROOT, 'api/transport.js'), 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const transportModule = { exports: {} };
vm.runInNewContext(
  `${transportSource}\nmodule.exports = { resolveTransport };`,
  { module: transportModule, exports: transportModule.exports, decodeURIComponent },
);
const adminRoutes = [
  ['GET', '/admin/queues/content', {}, 'admin/queue', { queue: 'content' }],
  ['GET', '/admin/queues/board', {}, 'admin/queue', { queue: 'board' }],
  ['POST', '/admin/reviews/p-1/decision', { decision: 'reject', reason: '补充来源', expectedVersion: 3 }, 'admin/content/decide', { id: 'p-1', decision: 'reject', reason: '补充来源', expectedVersion: 3 }],
  ['POST', '/admin/topics/t-1/decision', { decision: 'archive', reason: '已过期' }, 'admin/topic/decide', { id: 't-1', decision: 'archive', reason: '已过期' }],
  ['POST', '/admin/boards/b-1/decision', { decision: 'reject', reason: '名称需要调整', expectedVersion: 4 }, 'admin/board/decide', { id: 'b-1', decision: 'reject', reason: '名称需要调整', expectedVersion: 4 }],
  ['POST', '/admin/members/applications/m-1', { decision: 'approve', reason: '' }, 'admin/membership/decide', { id: 'm-1', decision: 'approve', reason: '' }],
  ['POST', '/admin/reports/r-1/decision', { decision: 'hide', reason: '待核查' }, 'admin/report/decide', { id: 'r-1', decision: 'hide', reason: '待核查' }],
  ['POST', '/admin/collections/c-1/decision', { decision: 'skip', reason: '本期已满' }, 'admin/collection/decide', { id: 'c-1', decision: 'skip', reason: '本期已满' }],
  ['POST', '/admin/comments/comment-1/decision', { decision: 'reject', reason: '请补充表达', expectedVersion: 2 }, 'admin/comment/decide', { id: 'comment-1', decision: 'reject', reason: '请补充表达', expectedVersion: 2 }],
];
adminRoutes.forEach(([method, url, body, action, payload]) => {
  const resolved = transportModule.exports.resolveTransport(url, method, body);
  assert.deepEqual(plain(resolved), { action, payload });
});

const pageSource = readFileSync(join(ROOT, 'pages/admin/index.js'), 'utf8');
const componentSource = readFileSync(join(ROOT, 'components/moderation-item/index.wxml'), 'utf8');
assert.match(pageSource, /expectedVersion: item\.version/);
assert.match(pageSource, /item\.queue === 'comment'/);
assert.match(pageSource, /decideComment/);
assert.match(pageSource, /fetchPendingBoards/);
assert.match(pageSource, /decideBoard\(item\.id, \{ decision: key, reason, expectedVersion: item\.version \}\)/);
assert.match(pageSource, /pages\/community\/post\/index\?id=\$\{encodeURIComponent\(item\.id\)\}/);
assert.match(pageSource, /请填写处理理由/);
assert.match(pageSource, /session\.role === 'admin'|session\.role === 'moderator'/);
assert.match(componentSource, /bindtap="onAction"/);
assert.match(componentSource, /树洞身份/);
assert.match(componentSource, /item\.queue === 'content'/);
assert.match(componentSource, /查看内容/);
assert.match(componentSource, /查看摘要/);

let adminPageDefinition;
const boardQueueCalls = [];
const boardDecisionCalls = [];
const adminModals = [];
const adminPageSource = pageSource
  .replace(
    "import {\n  QUEUES,\n  fetchQueue,\n  normalizeQueueItem,\n  fetchAssetReviewStatuses,\n  submitDecision,\n  decideComment,\n  decideTopic,\n  decideMembership,\n  decideReport,\n  decideCollection,\n} from './moderation';",
    'const { QUEUES, fetchQueue, normalizeQueueItem, fetchAssetReviewStatuses, submitDecision, decideComment, decideTopic, decideMembership, decideReport, decideCollection } = __moderation;',
  )
  .replace("import { fetchPendingBoards, decideBoard } from '~/services/boards';", 'const { fetchPendingBoards, decideBoard } = __boards;')
  .replace("import { fetchUsageStatus } from './usage';", 'const { fetchUsageStatus } = __usage;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');
vm.runInNewContext(adminPageSource, {
  Page(definition) { adminPageDefinition = definition; },
  getApp: () => ({ eventBus: { on() {}, off() {} }, globalData: {} }),
  wx: { showToast() {}, showModal(options) { adminModals.push(options); }, stopPullDownRefresh() {} },
  __moderation: moderation,
  __boards: {
    async fetchPendingBoards(options) {
      boardQueueCalls.push(options);
      return { items: [{ id: 'b-1', title: '山茶读书会', summary: '每周共读', status: 'pending', version: 4 }], nextCursor: null };
    },
    async decideBoard(id, payload) {
      boardDecisionCalls.push({ id, payload });
      return { state: 'approved' };
    },
  },
  __usage: { fetchUsageStatus: async () => null },
  __navigation: { navigateTo() {} },
});
const adminPage = Object.assign(Object.create(adminPageDefinition), {
  data: { ...adminPageDefinition.data, accessState: 'allowed', activeQueue: 'board', items: [] },
  setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  },
});
const topicQueueServiceCallsBeforeBoardLoad = calls.length;
await adminPage.loadQueue();
assert.deepEqual(plain(boardQueueCalls), [{ cursor: '' }]);
assert.equal(calls.length, topicQueueServiceCallsBeforeBoardLoad, 'the board queue does not call the topic queue service');
assert.equal(adminPage.data.items[0].queue, 'board');
assert.deepEqual(plain(adminPage.data.items[0].actions.map((action) => action.key)), ['approve', 'reject']);
adminPage.confirmAction(adminPage.data.items[0], 'reject', '名称需要调整');
assert.equal(adminModals.at(-1).content, '提交后会记录处理理由。确认继续？');
adminPage.confirmAction(moderation.normalizeQueueItem({ id: 't-1' }, 'topic'), 'archive', '已过活动期');
assert.match(adminModals.at(-1).content, /并通知相关用户/);
await adminPage.executeAction(adminPage.data.items[0], 'approve', '');
assert.deepEqual(plain(boardDecisionCalls), [{ id: 'b-1', payload: { decision: 'approve', reason: '', expectedVersion: 4 } }]);
assert.equal(adminPage.data.items.length, 0, 'a successful board decision removes the item from the board queue');

console.log('OK: moderation queue DTO whitelist, action reasons, expectedVersion, and decision routes passed');
