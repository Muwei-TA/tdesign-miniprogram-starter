import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'pages/community/resubmit/index.js'), 'utf8')
  .replace("import { fetchPostDetail, resubmitRejectedPost } from '~/services/posts';", 'const fetchPostDetail = __fetchPostDetail; const resubmitRejectedPost = __resubmitRejectedPost;')
  .replace("import { bootstrapSession, scopedKey } from '~/services/session';", 'const bootstrapSession = __bootstrapSession; const scopedKey = __scopedKey;')
  .replace("import { createIdempotencyKey } from '~/utils/idempotency';", 'const createIdempotencyKey = __createIdempotencyKey;');

const storage = new Map();
let page;
let submitted;
let redirect;
const post = {
  id: 'p-rejected', status: 'rejected', version: 4, kind: 'article', title: '旧标题', body: '旧正文',
  visibility: 'club', identityMode: 'anonymous', statusText: '需要修改：补充来源',
  media: { count: 2 }, viewer: { isOwner: true },
};
vm.runInNewContext(source, {
  Page: (definition) => { page = definition; },
  __fetchPostDetail: async () => post,
  __resubmitRejectedPost: async (id, payload, key) => {
    submitted = { id, payload, key };
    return { id, state: 'pending', version: 5 };
  },
  __scopedKey: (name) => `hg:user:${name}`,
  __bootstrapSession: async () => ({ memberStatus: 'active' }),
  __createIdempotencyKey: () => 'resubmit-key',
  wx: {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    redirectTo: ({ url }) => { redirect = url; },
    showModal: () => {},
    showToast: () => {},
  },
  encodeURIComponent,
  getApp: () => ({
    globalData: { session: { memberStatus: 'active', user: { id: 'user' } } },
    eventBus: { on() {}, off() {} },
  }),
});

const instance = {
  data: { ...page.data },
  setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
};
Object.setPrototypeOf(instance, page);
await page.onLoad.call(instance, { id: 'p-rejected' });
assert.equal(instance.data.version, 4);
assert.equal(instance.data.mediaCount, 2);
page.onBodyInput.call(instance, { detail: { value: '新正文' } });
assert.equal(storage.get('hg:user:resubmit:p-rejected').body, '新正文');
await page.submitConfirmed.call(instance);
assert.deepEqual(JSON.parse(JSON.stringify(submitted)), {
  id: 'p-rejected', payload: { title: '旧标题', body: '新正文', expectedVersion: 4 }, key: 'resubmit-key',
});
assert.equal(storage.has('hg:user:resubmit:p-rejected'), false);
assert.match(redirect, /state=pending&scope=club&identity=anonymous&id=p-rejected/);

console.log('OK: rejected post restores owned detail, saves edit, resubmits version, and clears draft');
