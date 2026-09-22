import request, { withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 权限内搜索。服务端必须先确定权限，再排序、分页、返回摘要与总数。
 * 前端职责：防抖、丢弃过期响应、失败重试不清空输入（docs/08 P11）。
 */

let latestSeq = 0;

export function search({ q, scope = 'post', cursor = '' }) {
  latestSeq += 1;
  const seq = latestSeq;
  return request(withQuery(endpoints.search, { q, scope, cursor })).then((data) => ({
    ...data,
    // 页面侧丢弃 stale 响应，避免慢请求覆盖新查询结果
    stale: seq !== latestSeq,
  }));
}

/** 推荐词由编辑维护，不从私密内容自动抽取 */
export function fetchSuggestions() {
  return request(endpoints.searchSuggestions);
}

export default { search, fetchSuggestions };
