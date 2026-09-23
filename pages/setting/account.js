import request from '~/api/request';
import endpoints from '~/api/endpoints';

/** 数据权利操作均为服务端异步任务，页面不得把请求发出当作完成。 */
export function requestContentExport() {
  return request(endpoints.myExports, { method: 'POST' });
}

export function requestAccountDeletion() {
  return request(endpoints.myAccount, {
    method: 'DELETE',
    data: { confirm: '注销' },
  });
}

export default { requestContentExport, requestAccountDeletion };
