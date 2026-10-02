import request from '~/api/request';
import endpoints from '~/api/endpoints';

export const fetchPlatformClubs = () => request(endpoints.platformClubs);
export function managePlatformClub(action, payload) {
  const paths = { create: endpoints.platformClubs, update: endpoints.platformClubUpdate, status: endpoints.platformClubStatus, moderator: endpoints.platformClubModerator };
  return request(paths[action], { method: 'POST', data: payload });
}
