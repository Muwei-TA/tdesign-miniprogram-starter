import request from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 入社页面的用例层。
 *
 * 页面只依赖这里的契约，不直接拼装云函数 action。真实 transport 会把
 * `/session/me`、`/membership/applications*` 映射到后端的 session/membership action；
 * Mock 仍可用同一组路径运行。
 */
export function fetchMembershipSession() {
  return request(endpoints.sessionMe);
}

export function fetchMyMembershipApplication() {
  return request(endpoints.membershipMine);
}

export function submitMembershipApplication({ displayName, inviteCode, rulesVersion }) {
  return request(endpoints.membershipApply, {
    method: 'POST',
    data: { displayName, inviteCode, rulesVersion },
  });
}

export default {
  fetchMembershipSession,
  fetchMyMembershipApplication,
  submitMembershipApplication,
};
