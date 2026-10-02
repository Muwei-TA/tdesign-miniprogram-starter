import request, { requestForClub } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 入社页面的用例层。
 *
 * 页面只依赖这里的契约，不直接拼装云函数 action。真实 transport 会把
 * `/session/me`、`/membership/applications*` 映射到后端的 session/membership action；
 * Mock 仍可用同一组路径运行。
 */
export function fetchMembershipSession(clubId) {
  return clubId ? requestForClub(endpoints.sessionMe, clubId) : request(endpoints.sessionMe);
}

export function fetchMyMembershipApplication(clubId) {
  return clubId
    ? requestForClub(endpoints.membershipMine, clubId)
    : request(endpoints.membershipMine);
}

export function submitMembershipApplication({ displayName, inviteCode, rulesVersion }, clubId) {
  const call = clubId ? requestForClub : request;
  const args = clubId ? [endpoints.membershipApply, clubId] : [endpoints.membershipApply];
  return call(...args, {
    method: 'POST',
    data: { displayName, inviteCode, rulesVersion },
  });
}

export default {
  fetchMembershipSession,
  fetchMyMembershipApplication,
  submitMembershipApplication,
};
