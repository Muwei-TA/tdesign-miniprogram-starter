import { scopedKey } from './session';
import { createIdempotencyKey } from '~/utils/idempotency';

/**
 * 本地草稿（账号作用域）。首版存本机：
 * - 视频文件不跨会话保存，恢复时需重新选择并给出说明（docs/08 P04）
 * - 草稿与站内搜索彻底分离，不进入任何公共查询
 */

const INDEX_KEY = 'draft-index';

function readIndex() {
  return wx.getStorageSync(scopedKey(INDEX_KEY)) || [];
}

function writeIndex(list) {
  wx.setStorageSync(scopedKey(INDEX_KEY), list);
}

export function saveDraft(draft) {
  const id = draft.id || `draft-${Date.now().toString(36)}`;
  const payload = {
    ...draft,
    id,
    idempotencyKey: draft.idempotencyKey || createIdempotencyKey('post'),
    // 视频的本地临时路径不保证跨会话可用，标记后在恢复时提示重选
    video: draft.video ? { ...draft.video, staleAfterSession: true } : null,
    updatedAt: Date.now(),
  };
  wx.setStorageSync(scopedKey(`draft:${id}`), payload);

  const index = readIndex().filter((item) => item.id !== id);
  index.unshift({
    id,
    kind: payload.kind,
    title: payload.title || '',
    excerpt: (payload.body || '').slice(0, 40),
    updatedAt: payload.updatedAt,
  });
  writeIndex(index);
  return payload;
}

export function getDraft(id) {
  return wx.getStorageSync(scopedKey(`draft:${id}`)) || null;
}

export function listDrafts() {
  return readIndex();
}

export function removeDraft(id) {
  wx.removeStorageSync(scopedKey(`draft:${id}`));
  writeIndex(readIndex().filter((item) => item.id !== id));
}

export default { saveDraft, getDraft, listDrafts, removeDraft };
