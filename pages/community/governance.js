import request, { withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

const APPEAL_STATUS_LABELS = {
  submitted: '待处理',
  approved: '已批准，等待再次审核',
  rejected: '已驳回',
};

/** 申诉卡只展示白名单字段，不传递原文或作者身份。 */
export function normalizeAppeal(item = {}) {
  const status = item.status || 'submitted';
  const version = Number(item.version);
  const contentVersion = Number(item.contentVersion);
  return {
    appealId: item.appealId || '',
    postId: item.postId || '',
    contentVersion: Number.isInteger(contentVersion) ? contentVersion : null,
    status,
    statusText: APPEAL_STATUS_LABELS[status] || status,
    reason: item.reason || '',
    decision: item.decision || '',
    decisionReason: item.decisionReason || '',
    version: Number.isInteger(version) ? version : null,
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
  };
}

export function normalizeAppeals(payload = {}) {
  return {
    ...(payload || {}),
    items: Array.isArray(payload && payload.items) ? payload.items.map(normalizeAppeal) : [],
  };
}

export function fetchMyAppeals({ limit = 50 } = {}) {
  return request(withQuery(endpoints.myAppeals, { limit })).then(normalizeAppeals);
}

export function createAppeal({ postId, contentVersion, reason }) {
  return request(endpoints.appeals, {
    method: 'POST',
    data: { postId, contentVersion, reason },
  });
}
