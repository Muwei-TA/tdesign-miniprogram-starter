import request from '~/api/request';
import endpoints from '~/api/endpoints';

export function fetchMyLevels() {
  return request(endpoints.myLevels);
}

export function checkInForToday() {
  return request(endpoints.myCheckIn, { method: 'POST' });
}

export default { fetchMyLevels, checkInForToday };
