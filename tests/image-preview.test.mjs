import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadPreviewHelper({ fetchPostDetail, previewImage = () => {} }) {
  const source = readFileSync(join(ROOT, 'services/image-preview.js'), 'utf8')
    .replace("import { fetchPostDetail } from '~/services/posts';", 'const fetchPostDetail = __fetchPostDetail;')
    .replace('export async function previewPostImage', 'async function previewPostImage')
    .replace('export default { previewPostImage };', '')
    .concat('\nmodule.exports = { previewPostImage };');
  const module = { exports: {} };
  const messages = [];
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    __fetchPostDetail: fetchPostDetail,
    wx: {
      previewImage,
      showToast: (options) => messages.push(options),
    },
  });
  return { ...module.exports, messages };
}

const previewCalls = [];
const freshUrls = ['https://signed.example/fresh-1', 'https://signed.example/fresh-2'];
let fetchCount = 0;
const refreshed = loadPreviewHelper({
  async fetchPostDetail(id) {
    assert.equal(id, 'post-1');
    fetchCount += 1;
    return { id, media: { images: freshUrls } };
  },
  previewImage: (options) => previewCalls.push(options),
});

assert.equal(await refreshed.previewPostImage('post-1', '1'), true);
assert.equal(fetchCount, 1, 'tap should fetch a newly authorized detail');
assert.deepEqual(JSON.parse(JSON.stringify(previewCalls[0].urls)), freshUrls);
assert.equal(previewCalls[0].current, freshUrls[1]);
assert.equal(await refreshed.previewPostImage('post-1', 0), true);
assert.equal(fetchCount, 2, 'each tap must renew authorization instead of caching URLs');

const deniedPreviewCalls = [];
const denied = loadPreviewHelper({
  async fetchPostDetail() {
    throw Object.assign(new Error('not accessible'), { kind: 'not_accessible' });
  },
  previewImage: (options) => deniedPreviewCalls.push(options),
});
assert.equal(await denied.previewPostImage('post-revoked', 0), false);
assert.equal(deniedPreviewCalls.length, 0, 'authorization failure must never open a cached URL');
assert.match(denied.messages[0].title, /不可访问/);

const missingImageCalls = [];
const missingImage = loadPreviewHelper({
  async fetchPostDetail() {
    return { id: 'post-2', media: { images: [] } };
  },
  previewImage: (options) => missingImageCalls.push(options),
});
assert.equal(await missingImage.previewPostImage('post-2', 0), false);
assert.equal(missingImageCalls.length, 0, 'missing fresh image must not fall back to a stale URL');
assert.match(missingImage.messages[0].title, /不可访问/);

let invalidIndexFetches = 0;
const invalidIndex = loadPreviewHelper({
  async fetchPostDetail() {
    invalidIndexFetches += 1;
    return { media: { images: ['https://signed.example/fresh'] } };
  },
});
assert.equal(await invalidIndex.previewPostImage('post-2', ''), false);
assert.equal(invalidIndexFetches, 0, 'an absent image index must not silently preview image zero');

const previewFailure = loadPreviewHelper({
  async fetchPostDetail() {
    return { media: { images: ['https://signed.example/fresh'] } };
  },
  previewImage: (options) => options.fail(),
});
assert.equal(await previewFailure.previewPostImage('post-3', 0), true);
assert.match(previewFailure.messages[0].title, /打开失败/);

for (const page of [
  'pages/home/index.js',
  'pages/community/post/index.js',
  'pages/community/topic/index.js',
  'pages/community/profile/index.js',
]) {
  const source = readFileSync(join(ROOT, page), 'utf8');
  assert.match(source, /import \{ previewPostImage \} from '~\/services\/image-preview';/, `${page} uses the shared preview helper`);
  assert.doesNotMatch(source, /wx\.previewImage\(/, `${page} does not preview its cached signed URL directly`);
}

const releasePage = readFileSync(join(ROOT, 'pages/release/index.js'), 'utf8');
assert.match(releasePage, /wx\.previewImage\(/, 'local upload-image preview remains unchanged');

console.log('OK: post image preview renews signed URLs and fails closed without cached fallback');
