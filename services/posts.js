import request, { requestForClub, withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';
import { createIdempotencyKey } from '~/utils/idempotency';

/**
 * 内容用例层。
 * 约束：不做权限判断，只按服务端返回的 viewer.* 字段渲染（见 docs/05 5.6）。
 */

export const FEED_FILTERS = [
  { value: 'all', label: '全部' },
];

export const COMMENT_LIMIT = 1000;

/** 树洞信息流。filter=awaiting_reply 时由服务端计算"尚未收到有效文字回应" */
export function fetchFeed({ cursor = '', filter = 'all', topicId = '', boardId = '' } = {}) {
  const query = { cursor, topicId };
  if (boardId) query.boardId = boardId;
  if (filter === 'awaiting_reply') query.filter = filter;
  else if (filter !== 'all') query.type = filter;
  return request(withQuery(endpoints.posts, query));
}

/** 详情必须按 id 重新请求，不复用列表数据 */
export function fetchPostDetail(id, clubId = '') {
  const path = withPath(endpoints.postDetail, { id });
  return clubId ? requestForClub(path, clubId) : request(path);
}

/**
 * 提交内容。
 * @param {object} payload { kind, title, body, assetIds, visibility, identityMode,
 *                           topicId, commentsEnabled, collectionId, consentGranted }
 * @param {string} idempotencyKey 随草稿持久化，超时重试复用同一键
 */
export function submitPost(payload, idempotencyKey = createIdempotencyKey('post')) {
  return request(endpoints.posts, { method: 'POST', data: payload, idempotencyKey, timeout: 30000 });
}

/** 退回内容只修改文字；原附件、身份和可见范围由服务端保持。 */
export function resubmitRejectedPost(id, { title, body, expectedVersion }, idempotencyKey) {
  return request(withPath(endpoints.postResubmit, { id }), {
    method: 'PATCH',
    data: { title, body, expectedVersion },
    idempotencyKey,
    timeout: 30000,
  });
}

/** 首版只允许缩小范围；扩大需新建内容（docs/05 5.4） */
export function shrinkVisibility(id, visibility, expectedVersion, clubId = '') {
  const path = withPath(endpoints.postVisibility, { id });
  const call = clubId ? requestForClub : request;
  const args = clubId ? [path, clubId] : [path];
  return call(...args, {
    method: 'PATCH',
    data: { visibility, expectedVersion },
  });
}

export function deletePost(id, expectedVersion, clubId = '') {
  const path = withPath(endpoints.postDetail, { id });
  const call = clubId ? requestForClub : request;
  const args = clubId ? [path, clubId] : [path];
  return call(...args, {
    method: 'DELETE',
    data: { expectedVersion },
  });
}

/** 共鸣：幂等开关，页面侧做乐观更新并在失败时回滚 */
export function toggleReaction(id, next) {
  return request(withPath(endpoints.postReaction, { id }), { method: next ? 'PUT' : 'DELETE' });
}

export function toggleBookmark(id, next) {
  return request(withPath(endpoints.postBookmark, { id }), { method: next ? 'PUT' : 'DELETE' });
}

export function fetchComments(id, cursor = '', clubId = '') {
  const path = withQuery(withPath(endpoints.postComments, { id }), { cursor });
  return clubId ? requestForClub(path, clubId) : request(path);
}

/** 提交回应后由服务端进行安全检查；通常立即发布，需人工复核时返回 pending。 */
export function submitComment(id, { body, replyToId = '', identityMode = 'named' }, idempotencyKey) {
  return request(withPath(endpoints.postComments, { id }), {
    method: 'POST',
    timeout: 30000,
    data: { body: String(body || '').trim(), replyToId, identityMode },
    idempotencyKey: idempotencyKey || createIdempotencyKey('comment'),
  });
}

/** 回应共鸣：幂等开关，页面侧做乐观更新并在失败时回滚 */
export function toggleCommentReaction(id, commentId, next) {
  return request(withPath(endpoints.postCommentReaction, { id, commentId }), { method: next ? 'PUT' : 'DELETE' });
}

/** 评论者删除自己的回应；expectedVersion 来自 CommentDTO.version */
export function deleteComment(id, commentId, expectedVersion) {
  return request(withPath(endpoints.postCommentDetail, { id, commentId }), {
    method: 'DELETE',
    data: { expectedVersion },
  });
}

/** 我的内容列表：published/pending/draft/private/bookmark/topics */
export function fetchMyContents({ tab = 'published', cursor = '', clubId = '' } = {}) {
  const path = withQuery(endpoints.myContents, { tab, cursor });
  return clubId ? requestForClub(path, clubId) : request(path);
}

/** 举报：回执不等于认定违规 */
export function submitReport({ targetType, targetId, reason, evidence = '' }) {
  return request(endpoints.reports, {
    method: 'POST',
    data: { targetType, targetId, reason, evidence },
  });
}

export default {
  FEED_FILTERS,
  COMMENT_LIMIT,
  fetchFeed,
  fetchPostDetail,
  submitPost,
  resubmitRejectedPost,
  shrinkVisibility,
  deletePost,
  toggleReaction,
  toggleBookmark,
  fetchComments,
  submitComment,
  toggleCommentReaction,
  deleteComment,
  fetchMyContents,
  submitReport,
};
