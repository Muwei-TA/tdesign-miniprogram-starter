import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = (value) => JSON.parse(JSON.stringify(value));

const serviceSource = readFileSync(join(ROOT, 'services/moderation.js'), 'utf8')
  .replace("import request, { withPath, withQuery } from '~/api/request';", 'const request = __request; const withPath = __withPath; const withQuery = __withQuery;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'const __default = {');

const calls = [];
const endpoints = {
  adminQueue: '/admin/queues/:queue',
  adminDecision: '/admin/reviews/:id/decision',
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
  `${serviceSource}\nmodule.exports = { QUEUES, QUEUE_LABELS, ACTIONS_BY_QUEUE, getQueueActions, normalizeQueueItem, fetchQueue, submitDecision, decideMembership, decideTopic, decideReport, decideCollection };`,
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

assert.deepEqual(plain(moderation.QUEUES.map((queue) => queue.value)), ['content', 'topic', 'member', 'report', 'collection']);
assert.equal(moderation.ACTIONS_BY_QUEUE.report.find((action) => action.key === 'keep').requiresReason, true);
assert.equal(moderation.ACTIONS_BY_QUEUE.content.find((action) => action.key === 'approve').requiresReason, false);
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
assert.deepEqual(calls.slice(2).map((call) => call.url), [
  '/admin/topics/t-1/decision',
  '/admin/members/applications/m-1',
  '/admin/reports/r-1/decision',
  '/admin/collections/c-1/decision',
]);

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
  ['POST', '/admin/reviews/p-1/decision', { decision: 'reject', reason: '补充来源', expectedVersion: 3 }, 'admin/content/decide', { id: 'p-1', decision: 'reject', reason: '补充来源', expectedVersion: 3 }],
  ['POST', '/admin/topics/t-1/decision', { decision: 'archive', reason: '已过期' }, 'admin/topic/decide', { id: 't-1', decision: 'archive', reason: '已过期' }],
  ['POST', '/admin/members/applications/m-1', { decision: 'approve', reason: '' }, 'admin/membership/decide', { id: 'm-1', decision: 'approve', reason: '' }],
  ['POST', '/admin/reports/r-1/decision', { decision: 'hide', reason: '待核查' }, 'admin/report/decide', { id: 'r-1', decision: 'hide', reason: '待核查' }],
  ['POST', '/admin/collections/c-1/decision', { decision: 'skip', reason: '本期已满' }, 'admin/collection/decide', { id: 'c-1', decision: 'skip', reason: '本期已满' }],
];
adminRoutes.forEach(([method, url, body, action, payload]) => {
  const resolved = transportModule.exports.resolveTransport(url, method, body);
  assert.deepEqual(plain(resolved), { action, payload });
});

const pageSource = readFileSync(join(ROOT, 'pages/admin/index.js'), 'utf8');
const componentSource = readFileSync(join(ROOT, 'components/moderation-item/index.wxml'), 'utf8');
assert.match(pageSource, /expectedVersion: item\.version/);
assert.match(pageSource, /请填写处理理由/);
assert.match(pageSource, /session\.role === 'admin'|session\.role === 'moderator'/);
assert.match(componentSource, /bindtap="onAction"/);
assert.match(componentSource, /树洞身份/);

console.log('OK: moderation queue DTO whitelist, action reasons, expectedVersion, and decision routes passed');
