import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const serviceSource = readFileSync(join(ROOT, 'pages/release/uploads.js'), 'utf8')
  .replace("import request, { withPath } from '~/api/request';", 'const request = __request; const withPath = __withPath;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace("import { createIdempotencyKey } from '~/utils/idempotency';", 'const createIdempotencyKey = __createIdempotencyKey;')
  .replace(/export async function /g, 'async function ')
  .replace(/export function /g, 'function ')
  .replace(/export const /g, 'const ')
  .replace('export default {', 'const serviceDefault = {');

const state = { calls: [], statuses: [] };
const wx = {
  compressImage(options) {
    options.success({ tempFilePath: '/tmp/compressed.png' });
  },
  getFileInfo(options) {
    options.success({ size: 64 });
  },
  getFileSystemManager() {
    return {
      readFile(options) {
        options.success({
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        });
      },
    };
  },
};

const request = async (url, options = {}) => {
  state.calls.push({ url, options });
  if (url === '/assets/upload-intents') return { assetId: 'asset-1', expiresAt: 'later' };
  if (url === '/assets/upload') return { assetId: 'asset-1', status: 'uploaded' };
  if (url === '/assets/confirm') return { assetId: 'asset-1', status: 'uploaded' };
  if (url === '/assets/asset-1') return state.statuses.shift() || { status: 'verified', url: 'https://signed' };
  throw new Error('unexpected endpoint ' + url);
};

const serviceModule = { exports: {} };
const context = {
  module: serviceModule,
  exports: serviceModule.exports,
  __request: request,
  __withPath: (template, params) => template.replace(':id', params.id),
  __endpoints: {
    uploadIntents: '/assets/upload-intents',
    assetUpload: '/assets/upload',
    assetConfirm: '/assets/confirm',
    assetDetail: '/assets/:id',
  },
  __createIdempotencyKey: (prefix) => prefix + '-test-' + Math.random().toString(36).slice(2, 8),
  wx,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(
  serviceSource + '\nmodule.exports = { LIMITS, IMAGE_STATUS, validateImages, prepareImageFile, uploadImages };',
  context,
);

const { LIMITS, IMAGE_STATUS, validateImages, prepareImageFile, uploadImages } = serviceModule.exports;

assert.equal(validateImages([{ tempFilePath: '/tmp/a.jpg', size: LIMITS.imageSize + 1 }]).ok, false);
assert.equal(
  validateImages([{ tempFilePath: '/tmp/a.jpg', size: LIMITS.imageSize + 1 }], 0, { allowCompression: true }).ok,
  true,
);
assert.equal(validateImages([{ tempFilePath: '/tmp/a.gif', size: 10 }]).ok, false);
assert.equal(validateImages(new Map()).ok, false);

const prepared = await prepareImageFile({ tempFilePath: '/tmp/source.png', size: LIMITS.imageSize + 1 });
assert.equal(prepared.status, IMAGE_STATUS.LOCAL);
assert.equal(prepared.filePath, '/tmp/compressed.png');
assert.equal(prepared.mimeType, 'image/png');
assert.equal(prepared.size > 0, true);

state.calls.length = 0;
state.statuses.push({ status: 'verifying' }, { status: 'verified', url: 'https://signed/image-1' });
const uploaded = await uploadImages([prepared], { pollIntervalMs: 0, pollMaxAttempts: 2 });
assert.equal(uploaded[0].status, IMAGE_STATUS.VERIFIED);
assert.equal(uploaded[0].assetId, 'asset-1');
assert.equal(uploaded[0].url, 'https://signed/image-1');

const intentCall = state.calls.find((call) => call.url === '/assets/upload-intents');
const uploadCall = state.calls.find((call) => call.url === '/assets/upload');
const confirmCall = state.calls.find((call) => call.url === '/assets/confirm');
assert.equal(intentCall.options.idempotencyKey.startsWith('asset-intent-'), true);
assert.equal(uploadCall.options.idempotencyKey.startsWith('asset-upload-'), true);
assert.equal(confirmCall.options.idempotencyKey.startsWith('asset-confirm-'), true);
assert.equal(Object.prototype.hasOwnProperty.call(confirmCall.options.data, 'fileId'), false);

const callCountAfterSuccess = state.calls.length;
const retried = await uploadImages(uploaded, { pollIntervalMs: 0, pollMaxAttempts: 1 });
assert.equal(retried[0].assetId, 'asset-1');
assert.equal(state.calls.length, callCountAfterSuccess + 1, '重试只应刷新状态，不应再次上传');
assert.equal(state.calls.filter((call) => call.url === '/assets/upload').length, 1);

state.statuses.push({ status: 'verifying' });
await assert.rejects(
  uploadImages([prepared], { pollIntervalMs: 0, pollMaxAttempts: 1 }),
  (error) => {
    assert.equal(error.code, 'poll_timeout');
    assert.equal(error.items[0].status, IMAGE_STATUS.FAILED);
    return true;
  },
);

console.log('OK: image prepare, controlled upload DTO, stable keys, polling bound, and retry reuse passed');
