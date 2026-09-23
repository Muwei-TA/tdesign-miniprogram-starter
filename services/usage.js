import request from '~/api/request';
import endpoints from '~/api/endpoints';

/** 管理台用量快照；服务端仍负责 moderator/admin 鉴权与汇总计算。 */
export function fetchUsageStatus() {
  return request(endpoints.adminUsageStatus);
}

export default { fetchUsageStatus };
