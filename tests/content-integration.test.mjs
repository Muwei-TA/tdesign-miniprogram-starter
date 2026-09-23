import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 运行真实发布分包草稿实现，只替换小程序 alias 与 storage 前缀。
const draftSource = readFileSync(join(ROOT, 'pages/release/drafts.js'), 'utf8')
  .replace("import { scopedKey } from '~/services/session';", 'const scopedKey = (name) => `test:${name}`;')
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

const communityDraftSource = readFileSync(join(ROOT, 'pages/community/drafts.js'), 'utf8')
  .replace("import { scopedKey } from '~/services/session';", 'const scopedKey = (name) => `test:${name}`;')
  .replace(/export function /g, 'function ')
  .concat('\nmodule.exports = { listDrafts, removeDraft };');
const communityDraftModule = { exports: {} };
vm.runInNewContext(communityDraftSource, { module: communityDraftModule, wx });
assert.deepEqual(
  Array.from(communityDraftModule.exports.listDrafts(), (item) => item.id),
  ['d2', 'd1'],
  '我的内容分包应读到发布分包保存的账号作用域草稿',
);
communityDraftModule.exports.removeDraft('d1');
assert.equal(getDraft('d1'), null, '删除草稿应同时移除账号作用域内容');

const releaseSource = readFileSync(join(ROOT, 'pages/release/index.js'), 'utf8');
assert.match(releaseSource, /session-changed/);
assert.match(releaseSource, /capabilities\.uploads !== true/);
assert.match(releaseSource, /capabilities\.publishing !== true/);

console.log('OK: draft idempotency stability and release capability gates passed');
