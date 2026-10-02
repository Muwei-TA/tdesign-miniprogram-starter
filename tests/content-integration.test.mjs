import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 运行真实发布分包草稿实现，只替换小程序 alias 与 storage 前缀。
const draftSource = readFileSync(join(ROOT, 'pages/release/drafts.js'), 'utf8')
  .replace("import { getSession, scopedKey } from '~/services/session';", 'const scopedKey = (name) => `test:${name}`; const getSession = () => ({ club: { id: "club-a" } });')
  .replace("import { migrateLegacyDraft, migrateLegacyDraftIndex, removeLegacyDraft } from '~/services/legacy-drafts';", 'const migrateLegacyDraft = () => null; const migrateLegacyDraftIndex = () => []; const removeLegacyDraft = () => {};')
  .replace(
    "import { createIdempotencyKey } from '~/utils/idempotency';",
    'let sequence = 0; const createIdempotencyKey = (prefix) => `${prefix}-test-${++sequence}`;',
  )
  .replace(/export function /g, 'function ')
  .replace('export default { saveDraft, getDraft, listDrafts, removeDraft };', '')
  .concat('\nmodule.exports = { saveDraft, getDraft, listDrafts, removeDraft };');

const storage = new Map();
const wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
};
const draftModule = { exports: {} };
vm.runInNewContext(draftSource, { module: draftModule, exports: draftModule.exports, wx });

const { saveDraft, getDraft } = draftModule.exports;
const first = saveDraft({ id: 'd1', kind: 'fragment', title: '', body: '第一句' });
const same = saveDraft({ id: 'd1', kind: 'fragment', title: '', body: '第一句', idempotencyKey: 'client-retry-key' });
assert.equal(same.idempotencyKey, first.idempotencyKey, '同内容草稿应复用幂等键');

const changed = saveDraft({
  id: 'd1',
  kind: 'fragment',
  title: '',
  body: '改过的一句',
  idempotencyKey: same.idempotencyKey,
});
assert.notEqual(changed.idempotencyKey, first.idempotencyKey, '内容修改后必须生成新幂等键');
const changedRetry = saveDraft({ id: 'd1', kind: 'fragment', title: '', body: '改过的一句' });
assert.equal(changedRetry.idempotencyKey, changed.idempotencyKey, '修改后的同内容重试仍应稳定');

const collectionDraft = saveDraft({ id: 'd2', kind: 'article', title: '标题', body: '正文', collectionId: 'c1' });
const collectionChanged = saveDraft({ id: 'd2', kind: 'article', title: '标题', body: '正文', collectionId: 'c2' });
assert.notEqual(collectionChanged.idempotencyKey, collectionDraft.idempotencyKey, '投稿目标变化应视为内容变化');

const associatedDraft = saveDraft({
  id: 'd3',
  kind: 'fragment',
  body: '同时选择板块与话题',
  board: { id: 'b1', title: '山茶读书会' },
  topic: { id: 't1', title: '最近在读' },
});
assert.equal(getDraft('d3').board.id, 'b1', '草稿应保留独立的板块关联');
assert.equal(getDraft('d3').topic.id, 't1', '草稿应同时保留话题关联');
const changedBoard = saveDraft({
  id: 'd3',
  kind: 'fragment',
  body: '同时选择板块与话题',
  board: { id: 'b2', title: '短篇讨论' },
  topic: { id: 't1', title: '最近在读' },
});
assert.notEqual(changedBoard.idempotencyKey, associatedDraft.idempotencyKey, '更换板块应更新发布幂等键');

const communityDraftSource = readFileSync(join(ROOT, 'pages/community/drafts.js'), 'utf8')
  .replace("import { scopedKey } from '~/services/session';", 'const scopedKey = (name) => `test:${name}`;')
  .replace("import { migrateLegacyDraftIndex, removeLegacyDraft } from '~/services/legacy-drafts';", 'const migrateLegacyDraftIndex = () => wx.getStorageSync(scopedKey("draft-index")) || []; const removeLegacyDraft = () => {};')
  .replace(/export function /g, 'function ')
  .concat('\nmodule.exports = { listDrafts, removeDraft };');
const communityDraftModule = { exports: {} };
vm.runInNewContext(communityDraftSource, { module: communityDraftModule, wx });
assert.deepEqual(
  Array.from(communityDraftModule.exports.listDrafts(), (item) => item.id),
  ['d3', 'd2', 'd1'],
  '我的内容分包应读到发布分包保存的账号作用域草稿',
);
communityDraftModule.exports.removeDraft('d1');
assert.equal(getDraft('d1'), null, '删除草稿应同时移除账号作用域内容');

const releaseSource = readFileSync(join(ROOT, 'pages/release/index.js'), 'utf8');
assert.match(releaseSource, /session-changed/);
assert.match(releaseSource, /capabilities\.uploads !== true/);
assert.match(releaseSource, /capabilities\.publishing !== true/);
assert.match(releaseSource, /topicId: this\.data\.topic \? this\.data\.topic\.id : ''/);
assert.match(releaseSource, /boardId: this\.data\.visibility === 'private' \|\| !this\.data\.board \? '' : this\.data\.board\.id/);

console.log('OK: draft idempotency stability and release capability gates passed');
