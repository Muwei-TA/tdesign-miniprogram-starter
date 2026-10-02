import request, { requestForClub, withPath } from '~/api/request';
import endpoints from '~/api/endpoints';

function normalizeList(data) {
  return Array.isArray(data && data.list) ? data.list : [];
}

export async function fetchMyClubs() {
  const data = await request(endpoints.myClubs);
  return normalizeList(data);
}

export async function fetchClubs() {
  const data = await request(endpoints.clubs);
  return normalizeList(data);
}

export function fetchClub(id) {
  if (!id) return Promise.reject(new Error('社团信息缺失'));
  return requestForClub(withPath(endpoints.clubDetail, { id }), id);
}

export default { fetchMyClubs, fetchClubs, fetchClub };
