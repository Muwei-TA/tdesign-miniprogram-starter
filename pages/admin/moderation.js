import request, { withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 管理台六队列。注意：分包与前端隐藏都不是安全边界，接口必须由服务端按角色鉴权。
 * 普通管理员不可读私密手记与匿名映射；举报记录不暴露举报人。
 */

export const QUEUES = [
  { value: 'content', label: '内容' },
  { value: 'comment', label: '回应' },
  { value: 'topic', label: '话题' },
  { value: 'member', label: '入社' },
  { value: 'report', label: '举报' },
  { value: 'collection', label: '文集' },
];

export const QUEUE_LABELS = QUEUES.reduce((labels, queue) => ({ ...labels, [queue.value]: queue.label }), {});

/**
 * 管理动作只描述工作流，不承担权限判断；最终权限由后端 policies.canAccessModeration 决定。
 * requiresReason 与 backend/domain/moderation.js 的必填字段保持一致。
 */
export const ACTIONS_BY_QUEUE = {
  content: [
    { key: 'approve', label: '通过', theme: 'primary', requiresReason: false },
    { key: 'reject', label: '退回修改', theme: 'secondary', requiresReason: true },
    { key: 'hide', label: '暂时隐藏', theme: 'danger', requiresReason: true },
  ],
  comment: [
    { key: 'approve', label: '通过回应', theme: 'primary', requiresReason: false },
    { key: 'reject', label: '退回回应', theme: 'secondary', requiresReason: true },
    { key: 'hide', label: '隐藏回应', theme: 'danger', requiresReason: true },
  ],
  topic: [
    { key: 'approve', label: '通过话题', theme: 'primary', requiresReason: false },
    { key: 'archive', label: '归档', theme: 'secondary', requiresReason: true },
    { key: 'reject', label: '退回话题', theme: 'danger', requiresReason: true },
  ],
  member: [
    { key: 'approve', label: '批准入社', theme: 'primary', requiresReason: false },
    { key: 'reject', label: '拒绝申请', theme: 'danger', requiresReason: true },
  ],
  report: [
    { key: 'keep', label: '保留内容', theme: 'secondary', requiresReason: true },
    { key: 'hide', label: '暂时隐藏', theme: 'danger', requiresReason: true },
    { key: 'escalate', label: '升级处理', theme: 'primary', requiresReason: true },
  ],
  collection: [
    { key: 'include', label: '收录', theme: 'primary', requiresReason: false },
    { key: 'skip', label: '暂不收录', theme: 'secondary', requiresReason: true },
  ],
};

const DECISION_ENDPOINTS = {
  comment: endpoints.adminCommentDecision,
  topic: '/admin/topics/:id/decision',
  report: '/admin/reports/:id/decision',
  collection: '/admin/collections/:id/decision',
};

export function getQueueActions(queue) {
  return (ACTIONS_BY_QUEUE[queue] || []).map((action) => ({ ...action }));
}

/**
 * 只把后端管理 DTO 中允许展示的字段交给页面。
 * 即使服务端未来误带 ownerId/reporterId/mappings，前端也不应把它们传进组件。
 */
export function normalizeQueueItem(item = {}, queue = item.queue || 'content') {
  const normalized = {
    id: item.id,
    queue,
    queueLabel: QUEUE_LABELS[queue] || queue,
    title: item.title || '',
    summary: item.summary || '',
    submittedAtText: item.submittedAtText || '',
    statusText: item.statusText || '',
    version: Number.isInteger(item.version) ? item.version : null,
    actions: getQueueActions(queue),
    // 组件只显示"树洞身份"标记，不接收任何身份映射字段。
    isAnonymous: (queue === 'content' || queue === 'comment') && item.isAnonymous === true,
    assetIds: queue === 'content' && Array.isArray(item.assetIds) ? item.assetIds.slice() : [],
  };

  if (queue === 'content') normalized.visibility = item.visibility || '';
  if (queue === 'comment') {
    // 只保留回应正文，拒绝将未来 DTO 中可能出现的身份字段带入页面。
    normalized.comment = typeof item.comment === 'string' ? item.comment : '';
    normalized.postId = item.postId || '';
  }
  if (queue === 'report') {
    normalized.targetType = item.targetType || '';
    normalized.targetId = item.targetId || '';
  }
  if (queue === 'collection') {
    normalized.postId = item.postId || '';
    normalized.collectionId = item.collectionId || '';
  }
  return normalized;
}

export function fetchQueue({ queue = 'content', cursor = '' } = {}) {
  return request(withQuery(withPath(endpoints.adminQueue, { queue }), { cursor })).then((data) => ({
    ...(data || {}),
    items: (data && Array.isArray(data.items) ? data.items : []).map((item) => normalizeQueueItem(item, queue)),
    nextCursor: data && data.nextCursor ? data.nextCursor : null,
  }));
}

/** 管理员审片只使用后端授权的媒体 URL，不拼接 cloudPath 或对象存储路径。 */
export function fetchAssetReviewStatuses(assetIds = []) {
  const ids = Array.isArray(assetIds) ? assetIds.filter(Boolean) : [];
  return Promise.all(ids.map((assetId) => request(withPath(endpoints.assetDetail, { id: assetId }))));
}

/** 退回/隐藏必须带理由；expectedVersion 用于并发版本锁，重复提交幂等 */
export function submitDecision(id, { decision, reason, expectedVersion }) {
  return request(withPath(endpoints.adminDecision, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideMembership(id, { decision, reason, expectedVersion }) {
  return request(withPath(endpoints.adminMemberDecision, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideTopic(id, { decision, reason = '', expectedVersion }) {
  return request(withPath(DECISION_ENDPOINTS.topic, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideReport(id, { decision, reason, expectedVersion }) {
  return request(withPath(DECISION_ENDPOINTS.report, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideCollection(id, { decision, reason = '', expectedVersion }) {
  return request(withPath(DECISION_ENDPOINTS.collection, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideComment(id, { decision, reason, expectedVersion }) {
  return request(withPath(DECISION_ENDPOINTS.comment, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export default {
  QUEUES,
  QUEUE_LABELS,
  ACTIONS_BY_QUEUE,
  getQueueActions,
  normalizeQueueItem,
  fetchQueue,
  fetchAssetReviewStatuses,
  submitDecision,
  decideComment,
  decideMembership,
  decideTopic,
  decideReport,
  decideCollection,
};
