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

/**
 * 只根据可提交内容生成指纹：同内容重试沿用同一幂等键，内容发生变化则换键。
 * 不把正文写入埋点；指纹只存在账号作用域的本地草稿里，服务端不会收到它。
 */
function draftFingerprint(draft) {
  return JSON.stringify({
    kind: draft.kind || 'fragment',
    title: draft.title || '',
    body: draft.body || '',
    images: draft.images || [],
    video: draft.video ? { ...draft.video, staleAfterSession: undefined } : null,
    visibility: draft.visibility || 'club',
    identityMode: draft.identityMode || 'named',
    commentsEnabled: draft.commentsEnabled !== false,
    topic: draft.topic || null,
    collectionId: draft.collectionId || '',
    consentGranted: !!draft.consentGranted,
  });
}

function chooseIdempotencyKey(draft, previous, sameContent) {
  if (sameContent && previous.idempotencyKey) return previous.idempotencyKey;
  if (!previous && draft.idempotencyKey) return draft.idempotencyKey;
  return createIdempotencyKey('post');
}

export function getDraft(id) {
  return wx.getStorageSync(scopedKey(`draft:${id}`)) || null;
}

export function saveDraft(draft) {
  const id = draft.id || `draft-${Date.now().toString(36)}`;
  const previous = draft.id ? getDraft(draft.id) : null;
  const fingerprint = draftFingerprint(draft);
  const previousFingerprint = previous && (previous.draftFingerprint || draftFingerprint(previous));
  const sameContent = !!previous && previousFingerprint === fingerprint;
  const payload = {
    ...draft,
    id,
    idempotencyKey: chooseIdempotencyKey(draft, previous, sameContent),
    draftFingerprint: fingerprint,
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

export function listDrafts() {
  return readIndex();
}

export function removeDraft(id) {
  wx.removeStorageSync(scopedKey(`draft:${id}`));
  writeIndex(readIndex().filter((item) => item.id !== id));
}

export default { saveDraft, getDraft, listDrafts, removeDraft };
