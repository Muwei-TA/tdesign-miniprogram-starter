/* eslint-disable no-await-in-loop, no-restricted-syntax, no-use-before-define, no-continue, prefer-template */

import request, { withPath } from '~/api/request';
import endpoints from '~/api/endpoints';
import { createIdempotencyKey } from '~/utils/idempotency';

export const LIMITS = {
  imageCount: 9,
  imageSize: 2 * 1024 * 1024,
  videoCount: 1,
  videoSize: 30 * 1024 * 1024,
  videoDuration: 60,
};

export const IMAGE_STATUS = {
  LOCAL: 'local',
  PREPARING: 'preparing',
  INTENT: 'intent',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_ATTEMPTS = 30;

function uploadError(message, { code = 'upload_failed', retryable = false, cause = null } = {}) {
  const error = new Error(message);
  error.name = 'UploadError';
  error.code = code;
  error.retryable = retryable;
  error.cause = cause;
  return error;
}

function isRetryableError(error) {
  return !!(
    error &&
    (error.retryable ||
      ['network', 'timeout', 'server', 'rate_limited', 'conflict'].includes(error.kind) ||
      ['network', 'timeout', 'server', 'rate_limited', 'conflict'].includes(error.code))
  );
}

function pathExtension(filePath) {
  const path = String(filePath || '').split('?')[0].toLowerCase();
  const match = path.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function mimeFromPath(filePath) {
  const extension = pathExtension(filePath);
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return '';
}

function mimeFromFile(file = {}) {
  const value = String(file.mimeType || file.type || '').toLowerCase();
  if (value === 'image/jpeg' || value === 'image/jpg' || value === 'jpeg' || value === 'jpg') {
    return 'image/jpeg';
  }
  if (value === 'image/png' || value === 'png') return 'image/png';
  return mimeFromPath(file.tempFilePath || file.filePath || file.path);
}

function hasUnsupportedImageType(file = {}) {
  const declared = String(file.mimeType || file.type || '').toLowerCase();
  if (declared && declared.startsWith('image/') && !['image/jpeg', 'image/jpg', 'image/png'].includes(declared)) {
    return true;
  }
  const extension = pathExtension(file.tempFilePath || file.filePath || file.path);
  return !!extension && !['jpg', 'jpeg', 'png'].includes(extension);
}

function stripDataUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/^data:([^;,]+);base64,(.*)$/is);
  return {
    declaredMimeType: match ? String(match[1]).toLowerCase() : '',
    encoded: (match ? match[2] : text).replace(/\s+/g, ''),
  };
}

function decodedByteLength(encoded) {
  const padding = (encoded.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function mimeFromBase64(value) {
  const { encoded } = stripDataUrl(value);
  if (encoded.startsWith('/9j/')) return 'image/jpeg';
  if (encoded.startsWith('iVBORw0KGgo')) return 'image/png';
  return '';
}

function validateEncodedImage(value, declaredMimeType = '') {
  const parsed = stripDataUrl(value);
  if (!parsed.encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.encoded) || parsed.encoded.length % 4 === 1) {
    throw uploadError('图片编码不合法，请重新选择 JPEG 或 PNG 文件', {
      code: 'invalid_image',
    });
  }

  const actualMimeType = mimeFromBase64(value);
  const declared = String(declaredMimeType || parsed.declaredMimeType || '').toLowerCase();
  if (!actualMimeType || !['image/jpeg', 'image/png'].includes(actualMimeType)) {
    throw uploadError('只支持 JPEG 或 PNG 图片', { code: 'unsupported_type' });
  }
  if (declared && declared !== actualMimeType) {
    throw uploadError('图片类型与文件内容不一致，请重新选择', { code: 'invalid_type' });
  }

  const size = decodedByteLength(parsed.encoded);
  if (!size || size > LIMITS.imageSize) {
    throw uploadError(
      '单张图片不能超过 ' + Math.floor(LIMITS.imageSize / (1024 * 1024)) + 'MiB',
      { code: 'size_limit' },
    );
  }
  return { base64: parsed.encoded, size, mimeType: actualMimeType };
}

function callWx(method, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx[method] !== 'function') {
      reject(uploadError('当前微信版本不支持 ' + method, { code: 'unsupported_runtime' }));
      return;
    }
    wx[method]({
      ...options,
      success: resolve,
      fail: reject,
    });
  });
}

export function readFileBase64(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
      reject(uploadError('无法读取图片文件，请更新微信后重试', { code: 'unsupported_runtime' }));
      return;
    }
    const manager = wx.getFileSystemManager();
    if (!manager || typeof manager.readFile !== 'function') {
      reject(uploadError('无法读取图片文件，请重试', { code: 'unsupported_runtime' }));
      return;
    }
    manager.readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(typeof result.data === 'string' ? result.data : ''),
      fail: reject,
    });
  });
}

async function readValidatedImage(filePath, declaredMimeType = '') {
  const base64 = await readFileBase64(filePath);
  try {
    return validateEncodedImage(base64, declaredMimeType);
  } catch (error) {
    if (error.name === 'UploadError') throw error;
    throw uploadError('图片无法读取，请重新选择', { code: 'invalid_image', cause: error });
  }
}

async function compressImage(filePath) {
  if (typeof wx === 'undefined' || !filePath || typeof wx.compressImage !== 'function') return filePath;
  const result = await callWx('compressImage', { src: filePath, quality: 85 });
  return result.tempFilePath || filePath;
}

async function getFileInfo(filePath) {
  if (typeof wx === 'undefined' || !filePath || typeof wx.getFileInfo !== 'function') return null;
  try {
    return await callWx('getFileInfo', { filePath });
  } catch (error) {
    return null;
  }
}

/** 返回 { ok, message }，message 用于直接提示用户。 */
export function validateImages(files = [], existingCount = 0, { allowCompression = false } = {}) {
  if (!Array.isArray(files)) return { ok: false, message: '没有可上传的图片' };
  if (existingCount + files.length > LIMITS.imageCount) {
    return { ok: false, message: '一条内容最多 ' + LIMITS.imageCount + ' 张图片' };
  }
  const unsupported = files.find((file) => hasUnsupportedImageType(file));
  if (unsupported) return { ok: false, message: '只支持 JPEG 或 PNG 图片' };
  const tooLarge = files.find((file) => Number(file.size) > LIMITS.imageSize);
  if (tooLarge && !allowCompression) return { ok: false, message: '单张图片不能超过 2MiB' };
  return { ok: true };
}

export function validateVideo(file) {
  if (!file) return { ok: false, message: '未选择视频' };
  if (Number(file.size) > LIMITS.videoSize) return { ok: false, message: '视频源文件不能超过 30MB' };
  if (Number(file.duration) > LIMITS.videoDuration) return { ok: false, message: '视频时长请控制在 60 秒内' };
  return { ok: true };
}

/** 压缩并读取一次文件，确保选择阶段就能发现类型或体积问题。 */
export async function prepareImageFile(file) {
  const sourcePath = file && (file.tempFilePath || file.filePath || file.path);
  if (!sourcePath) throw uploadError('图片路径无效，请重新选择', { code: 'invalid_image' });

  const filePath = await compressImage(sourcePath);
  const hintedMimeType = mimeFromFile({ tempFilePath: filePath });
  const info = await getFileInfo(filePath);
  if (info && Number(info.size) > LIMITS.imageSize) {
    throw uploadError('压缩后的图片仍超过 2MiB，请选择较小文件', { code: 'size_limit' });
  }
  const encoded = await readValidatedImage(filePath, hintedMimeType);
  return {
    key: createIdempotencyKey('image'),
    localPath: sourcePath,
    filePath,
    previewPath: filePath,
    size: encoded.size,
    mimeType: encoded.mimeType,
    status: IMAGE_STATUS.LOCAL,
    assetId: '',
    intentKey: '',
    uploadKey: '',
    confirmKey: '',
    url: '',
    error: '',
    retryable: true,
  };
}

export async function prepareImageFiles(files = [], existingCount = 0) {
  const check = validateImages(files, existingCount, { allowCompression: true });
  if (!check.ok) throw uploadError(check.message, { code: 'invalid_input' });
  const prepared = [];
  for (const file of files) prepared.push(await prepareImageFile(file));
  return prepared;
}

export function normalizeImageItem(value) {
  if (typeof value === 'string') {
    return {
      key: value,
      localPath: value,
      filePath: value,
      previewPath: value,
      size: 0,
      mimeType: mimeFromPath(value),
      status: IMAGE_STATUS.LOCAL,
      assetId: '',
      intentKey: '',
      uploadKey: '',
      confirmKey: '',
      url: '',
      error: '',
      retryable: true,
    };
  }
  const item = value && typeof value === 'object' ? value : {};
  const localPath = item.localPath || item.filePath || item.previewPath || '';
  const assetId = item.assetId || '';
  return {
    ...item,
    key: item.key || localPath || assetId || createIdempotencyKey('image'),
    localPath,
    filePath: item.filePath || localPath,
    previewPath: item.previewPath || localPath || item.url || '',
    size: Number(item.size) || 0,
    mimeType: item.mimeType || mimeFromPath(localPath),
    status: assetId && item.status === IMAGE_STATUS.VERIFIED ? IMAGE_STATUS.VERIFIED : item.status || IMAGE_STATUS.LOCAL,
    assetId,
    intentKey: item.intentKey || '',
    uploadKey: item.uploadKey || '',
    confirmKey: item.confirmKey || '',
    url: item.url || '',
    error: item.error || '',
    retryable: item.retryable !== false,
  };
}

function emitItems(items, index, onItemChange) {
  if (typeof onItemChange === 'function') onItemChange(items.slice(), index);
}

function makeKeys(item) {
  return {
    ...item,
    intentKey: item.intentKey || createIdempotencyKey('asset-intent'),
    uploadKey: item.uploadKey || createIdempotencyKey('asset-upload'),
    confirmKey: item.confirmKey || createIdempotencyKey('asset-confirm'),
  };
}

function checkCanceled(control, items, index, onItemChange) {
  if (!control || !control.canceled) return;
  const item = { ...items[index], status: IMAGE_STATUS.CANCELED, error: '上传已取消', retryable: true };
  items[index] = item;
  emitItems(items, index, onItemChange);
  const error = uploadError('上传已取消，草稿已保留', { code: 'canceled', retryable: true });
  error.items = items.slice();
  error.index = index;
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForVerified(assetId, { pollIntervalMs, pollMaxAttempts, control, items, index, onItemChange }) {
  for (let attempt = 0; attempt < pollMaxAttempts; attempt += 1) {
    checkCanceled(control, items, index, onItemChange);
    const status = await fetchAssetStatus(assetId);
    if (!status || !status.status) throw uploadError('附件状态暂时不可用，请稍后重试', { code: 'status_unavailable', retryable: true });
    if (status.status === IMAGE_STATUS.VERIFIED) return status;
    if ([IMAGE_STATUS.FAILED, 'rejected'].includes(status.status)) {
      throw uploadError(status.failureReason || '图片未通过内容审核', {
        code: 'asset_rejected',
        retryable: false,
      });
    }
    if (attempt + 1 < pollMaxAttempts) await sleep(pollIntervalMs);
  }
  throw uploadError('图片仍在审核中，草稿已保存，请稍后重试', {
    code: 'poll_timeout',
    retryable: true,
  });
}

async function uploadOne(items, index, options) {
  const {
    control = { canceled: false },
    onItemChange,
    pollIntervalMs = POLL_INTERVAL_MS,
    pollMaxAttempts = POLL_MAX_ATTEMPTS,
  } = options;
  checkCanceled(control, items, index, onItemChange);

  let item = makeKeys(normalizeImageItem(items[index]));
  items[index] = { ...item, status: IMAGE_STATUS.PREPARING, error: '' };
  emitItems(items, index, onItemChange);

  let encoded = null;
  if (!item.assetId) {
    encoded = await readValidatedImage(item.filePath || item.localPath, item.mimeType);
    item = {
      ...items[index],
      size: encoded.size,
      mimeType: encoded.mimeType,
      status: IMAGE_STATUS.INTENT,
      retryable: true,
    };
    items[index] = item;
    emitItems(items, index, onItemChange);
    const intent = await createUploadIntent(
      { mediaType: 'image', size: encoded.size, mimeType: encoded.mimeType },
      item.intentKey,
    );
    item = {
      ...item,
      assetId: intent.assetId,
      expiresAt: intent.expiresAt || '',
    };
    items[index] = item;
    emitItems(items, index, onItemChange);
  }

  if (![IMAGE_STATUS.UPLOADED, IMAGE_STATUS.VERIFYING].includes(item.status)) {
    // 同一 pass 内复用已读取并校验的字节，避免重复读文件与二次 base64 校验
    if (!encoded) encoded = await readValidatedImage(item.filePath || item.localPath, item.mimeType);
    item = { ...items[index], status: IMAGE_STATUS.UPLOADING, error: '' };
    items[index] = item;
    emitItems(items, index, onItemChange);
    await uploadImage(item.assetId, encoded.base64, item.uploadKey);
    item = { ...items[index], status: IMAGE_STATUS.UPLOADED };
    items[index] = item;
    emitItems(items, index, onItemChange);
  }

  if (items[index].status !== IMAGE_STATUS.VERIFYING) {
    item = { ...items[index], status: IMAGE_STATUS.VERIFYING };
    items[index] = item;
    emitItems(items, index, onItemChange);
    await confirmUpload(item.assetId, item.confirmKey);
  }

  const status = await waitForVerified(item.assetId, {
    pollIntervalMs,
    pollMaxAttempts,
    control,
    items,
    index,
    onItemChange,
  });
  items[index] = {
    ...items[index],
    status: IMAGE_STATUS.VERIFIED,
    previewPath: items[index].previewPath || status.url || '',
    url: status.url || items[index].url || '',
    width: status.width || items[index].width || 0,
    height: status.height || items[index].height || 0,
    error: '',
    retryable: true,
  };
  emitItems(items, index, onItemChange);
}

/**
 * 逐个上传图片。返回完整附件项数组；失败时抛出带有 items 的 UploadError，
 * 页面可把已完成的 assetId 与当前失败状态一起写回草稿。
 */
export async function uploadImages(items = [], options = {}) {
  const next = items.map(normalizeImageItem);
  const indices = options.indices ? new Set(options.indices) : null;
  const control = options.control || { canceled: false };
  const { onItemChange } = options;

  for (let index = 0; index < next.length; index += 1) {
    if (indices && !indices.has(index)) continue;
    if (next[index].status === IMAGE_STATUS.VERIFIED && next[index].assetId) {
      try {
        const current = await fetchAssetStatus(next[index].assetId);
        if (!current || !current.status) {
          throw uploadError('附件状态暂时不可用，请稍后重试', { code: 'status_unavailable', retryable: true });
        }
        if (current.status === IMAGE_STATUS.VERIFIED) {
          next[index] = {
            ...next[index],
            url: current.url || next[index].url || '',
            width: current.width || next[index].width || 0,
            height: current.height || next[index].height || 0,
          };
          emitItems(next, index, onItemChange);
          continue;
        }
        if ([IMAGE_STATUS.FAILED, 'rejected'].includes(current.status)) {
          const rejected = uploadError(current.failureReason || '图片未通过内容审核', {
            code: 'asset_rejected',
            retryable: false,
          });
          next[index] = { ...next[index], status: IMAGE_STATUS.FAILED, error: rejected.message, retryable: false };
          emitItems(next, index, onItemChange);
          rejected.items = next.slice();
          rejected.index = index;
          throw rejected;
        }
        next[index] = { ...next[index], status: current.status || IMAGE_STATUS.VERIFYING };
      } catch (error) {
        const wrapped = error.name === 'UploadError' ? error : uploadError(error.message || '附件状态暂时不可用', {
          retryable: isRetryableError(error),
          cause: error,
        });
        wrapped.items = next.slice();
        wrapped.index = index;
        throw wrapped;
      }
    }
    try {
      await uploadOne(next, index, { ...options, control, onItemChange });
    } catch (error) {
      const item = {
        ...next[index],
        status: error.code === 'canceled' ? IMAGE_STATUS.CANCELED : IMAGE_STATUS.FAILED,
        error: error.message || '上传未完成',
        retryable: error.code !== 'asset_rejected' && error.code !== 'unsupported_type',
      };
      next[index] = item;
      emitItems(next, index, onItemChange);
      const wrapped = error.name === 'UploadError' ? error : uploadError(error.message || '上传未完成', {
        retryable: isRetryableError(error),
        cause: error,
      });
      wrapped.items = next.slice();
      wrapped.index = index;
      throw wrapped;
    }
  }
  return next;
}

/** 申请图片 intent；服务端仍会验证真实文件。 */
export function createUploadIntent({ mediaType, size, duration, mimeType }, idempotencyKey) {
  return request(endpoints.uploadIntents, {
    method: 'POST',
    data: { mediaType, size, duration, mimeType },
    idempotencyKey,
  });
}

/** 受控上传：base64 只进入云函数，不接受客户端 fileId。 */
export function uploadImage(assetId, contentBase64, idempotencyKey) {
  return request(endpoints.assetUpload, {
    method: 'POST',
    timeout: 30000,
    data: { assetId, contentBase64 },
    idempotencyKey,
  });
}

/** 确认服务端已经绑定的文件，不传 fileId。 */
export function confirmUpload(assetId, idempotencyKey) {
  return request(endpoints.assetConfirm, {
    method: 'POST',
    timeout: 30000,
    data: { assetId },
    idempotencyKey,
  });
}

/** 查询附件处理状态：verified 之后才能提交内容。 */
export function fetchAssetStatus(id) {
  return request(withPath(endpoints.assetDetail, { id }));
}

export default {
  LIMITS,
  IMAGE_STATUS,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  validateImages,
  validateVideo,
  prepareImageFile,
  prepareImageFiles,
  normalizeImageItem,
  readFileBase64,
  createUploadIntent,
  uploadImage,
  confirmUpload,
  fetchAssetStatus,
  uploadImages,
};
