import request, { withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

const MEMBER_STATUS_LABELS = {
  active: '正常',
  removed: '已移除',
  pending: '待确认',
  rejected: '未通过',
};

const ROLE_LABELS = {
  member: '成员',
  moderator: '版主',
  admin: '管理员',
};

const APPEAL_STATUS_LABELS = {
  submitted: '待处理',
  approved: '已批准，等待再次审核',
  rejected: '已驳回',
};

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

/** Members are an allow-list DTO; openid and arbitrary profile fields are dropped. */
export function normalizeMember(item = {}) {
  const status = item.status || 'active';
  const role = item.role || 'member';
  return {
    targetUserId: item.targetUserId || '',
    displayName: item.displayName || '未设置昵称',
    role,
    roleText: ROLE_LABELS[role] || role,
    status,
    statusText: MEMBER_STATUS_LABELS[status] || status,
    mutedUntil: item.mutedUntil || null,
    version: integerOrNull(item.version),
  };
}

export function normalizeMembers(payload = {}) {
  return {
    ...(payload || {}),
    items: Array.isArray(payload && payload.items) ? payload.items.map(normalizeMember) : [],
  };
}

/** Appeal cards deliberately exclude post body/title and author identity. */
export function normalizeAppeal(item = {}) {
  const status = item.status || 'submitted';
  return {
    appealId: item.appealId || '',
    postId: item.postId || '',
    contentVersion: integerOrNull(item.contentVersion),
    status,
    statusText: APPEAL_STATUS_LABELS[status] || status,
    reason: item.reason || '',
    decision: item.decision || '',
    decisionReason: item.decisionReason || '',
    version: integerOrNull(item.version),
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

export function fetchMembers({ limit = 50 } = {}) {
  return request(withQuery(endpoints.adminMembers, { limit })).then(normalizeMembers);
}

export function removeMember(targetUserId, expectedVersion, reason) {
  return request(withPath(endpoints.adminMemberRemove, { targetUserId }), {
    method: 'POST',
    data: { expectedVersion, reason },
  });
}

export function muteMember(targetUserId, expectedVersion, mutedUntil, reason) {
  return request(withPath(endpoints.adminMemberMute, { targetUserId }), {
    method: 'POST',
    data: { expectedVersion, mutedUntil, reason },
  });
}

export function changeMemberRole(targetUserId, expectedVersion, role, reason) {
  return request(withPath(endpoints.adminMemberRole, { targetUserId }), {
    method: 'POST',
    data: { expectedVersion, role, reason },
  });
}

export function createInvite({ maxUses = 1, ttlSeconds = 7 * 24 * 60 * 60 } = {}) {
  return request(endpoints.adminInvites, {
    method: 'POST',
    data: { maxUses, ttlSeconds },
  });
}

export function fetchMyAppeals({ limit = 50 } = {}) {
  return request(withQuery(endpoints.myAppeals, { limit })).then(normalizeAppeals);
}

export function fetchAdminAppeals({ limit = 50 } = {}) {
  return request(withQuery(endpoints.adminAppeals, { limit })).then(normalizeAppeals);
}

export function createAppeal({ postId, contentVersion, reason }) {
  return request(endpoints.appeals, {
    method: 'POST',
    data: { postId, contentVersion, reason },
  });
}

export function decideAppeal(appealId, { expectedVersion, decision, reason }) {
  return request(withPath(endpoints.adminAppealDecision, { appealId }), {
    method: 'POST',
    data: { expectedVersion, decision, reason },
  });
}

export default {
  MEMBER_STATUS_LABELS,
  ROLE_LABELS,
  APPEAL_STATUS_LABELS,
  normalizeMember,
  normalizeMembers,
  normalizeAppeal,
  normalizeAppeals,
  fetchMembers,
  removeMember,
  muteMember,
  changeMemberRole,
  createInvite,
  fetchMyAppeals,
  fetchAdminAppeals,
  createAppeal,
  decideAppeal,
};
