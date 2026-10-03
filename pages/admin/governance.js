import request, { requestForClub, withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

const MEMBER_STATUS_LABELS = {
  active: '正常',
  removed: '已移除',
  pending: '待确认',
  rejected: '未通过',
};

const ROLE_LABELS = {
  member: '成员',
  moderator: '社团负责人',
  admin: '审核管理员',
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

const INVITE_STATUS_LABELS = {
  active: '可用',
  exhausted: '已用完',
  expired: '已过期',
  revoked: '已撤销',
};

/** Invitation DTOs are an allow-list. Raw codes and hashes are never retained in lists. */
export function normalizeInvite(item = {}) {
  const status = item.status || 'active';
  const mode = item.mode === 'direct' ? 'direct' : 'application';
  return {
    inviteId: item.inviteId || '',
    mode,
    modeText: mode === 'direct' ? '定向直邀' : '公开申请',
    status,
    statusText: INVITE_STATUS_LABELS[status] || status,
    maxUses: integerOrNull(item.maxUses),
    usedCount: integerOrNull(item.usedCount) || 0,
    reservedCount: integerOrNull(item.reservedCount) || 0,
    expiresAt: item.expiresAt || '',
    version: integerOrNull(item.version),
    createdAt: item.createdAt || '',
    revokedAt: item.revokedAt || '',
    targetUserId: item.targetUserId || '',
  };
}

export function normalizeInvites(payload = {}) {
  return {
    ...(payload || {}),
    items: Array.isArray(payload && payload.items) ? payload.items.map(normalizeInvite) : [],
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

export function fetchMembers({ limit = 50, cursor = '', status = '' } = {}) {
  return request(withQuery(endpoints.adminMembers, { limit, cursor, status })).then(normalizeMembers);
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

export function fetchInvites({ limit = 50, cursor = '', status = '' } = {}) {
  return request(withQuery(endpoints.adminInvites, { limit, cursor, status })).then(normalizeInvites);
}

export function fetchGovernanceOverview() {
  return request(endpoints.adminOverview);
}

export function createInvite({ mode = 'application', maxUses = 1, ttlSeconds = 7 * 24 * 60 * 60, targetUserId, reason }) {
  return request(endpoints.adminInvites, {
    method: 'POST',
    data: { mode, maxUses, ttlSeconds, targetUserId, reason },
  });
}

export function revokeInvite(inviteId, expectedVersion, reason) {
  return request(withPath(endpoints.adminInviteRevoke, { inviteId }), {
    method: 'POST',
    data: { expectedVersion, reason },
  });
}

export function fetchWebLoginInfo(id) {
  return request(endpoints.accountWebLoginInfo, { method: 'POST', data: { id } });
}

export function approveWebLogin(id) {
  return request(endpoints.accountWebLoginApprove, { method: 'POST', data: { id } });
}

export function rejectWebLogin(id) {
  return request(endpoints.accountWebLoginReject, { method: 'POST', data: { id } });
}

function normalizeInboxItem(item = {}) {
  return {
    id: item.id || '',
    clubId: item.clubId || '',
    clubName: item.clubName || '社团',
    status: item.status || '',
    version: integerOrNull(item.version),
    expectedVersion: integerOrNull(item.expectedVersion),
    createdAt: item.createdAt || '',
    expiresAt: item.expiresAt || '',
    reason: item.reason || '',
    role: item.role || '',
    type: item.type || '',
    targetUserId: item.targetUserId || '',
    creatorId: item.creatorId || '',
    proposedTeam: Array.isArray(item.proposedTeam) ? item.proposedTeam.map((person) => ({
      displayName: person.displayName || '未设置昵称',
      role: person.role || 'member',
    })) : [],
    acceptedAt: item.acceptedAt || '',
    approvedAt: item.approvedAt || '',
  };
}

function normalizeInbox(payload = {}) {
  return {
    ...(payload || {}),
    items: Array.isArray(payload && payload.items) ? payload.items.map(normalizeInboxItem) : [],
  };
}

export function fetchAccountHandovers({ limit, cursor } = {}) {
  return request(withQuery(endpoints.accountHandovers, { limit, cursor })).then(normalizeInbox);
}

export function fetchAccountRecoveries({ limit, cursor } = {}) {
  return request(withQuery(endpoints.accountRecoveries, { limit, cursor })).then(normalizeInbox);
}

export function fetchAccountRecovery(id) {
  return request(withPath(endpoints.accountRecoveryInfo, { id }));
}

export function acceptHandover(id, expectedVersion, clubId) {
  return requestForClub(withPath(endpoints.adminHandoverAccept, { id }), clubId, {
    method: 'POST',
    data: { id, expectedVersion },
  });
}

export function declineHandover(id, expectedVersion, reason, clubId) {
  return requestForClub(withPath(endpoints.adminHandoverDecline, { id }), clubId, {
    method: 'POST',
    data: { id, expectedVersion, reason },
  });
}

export function acceptRecovery(recoveryId, expectedVersion, clubId) {
  return requestForClub(endpoints.accountRecoveryAccept, clubId, {
    method: 'POST',
    data: { recoveryId, expectedVersion },
  });
}

export function declineRecovery(recoveryId, expectedVersion, reason, clubId) {
  return requestForClub(endpoints.accountRecoveryDecline, clubId, {
    method: 'POST',
    data: { recoveryId, expectedVersion, reason },
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
  normalizeInvite,
  normalizeInvites,
  normalizeAppeal,
  normalizeAppeals,
  fetchMembers,
  removeMember,
  muteMember,
  changeMemberRole,
  createInvite,
  fetchInvites,
  fetchGovernanceOverview,
  revokeInvite,
  fetchWebLoginInfo,
  approveWebLogin,
  rejectWebLogin,
  fetchAccountHandovers,
  fetchAccountRecoveries,
  fetchAccountRecovery,
  acceptHandover,
  declineHandover,
  acceptRecovery,
  declineRecovery,
  fetchMyAppeals,
  fetchAdminAppeals,
  createAppeal,
  decideAppeal,
};
