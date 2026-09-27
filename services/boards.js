import request, { withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

/** 板块目录只读取服务端允许当前成员浏览的板块。 */
export function fetchBoards({ q = '', cursor = '', status = '' } = {}) {
  const query = { cursor };
  const keyword = String(q || '').trim();
  if (keyword) query.q = keyword;
  if (status) query.status = status;
  return request(withQuery(endpoints.boards, query));
}

/** 板块详情与帖子分页由独立 boards/detail action 返回。 */
export function fetchBoardDetail(id, cursor = '') {
  return request(withQuery(withPath(endpoints.boardDetail, { id }), { cursor }));
}

/** 社员创建后进入待审；管理员可由服务端直接创建 active。 */
export function submitBoard({ title, description }) {
  return request(endpoints.boards, {
    method: 'POST',
    data: { title: String(title || '').trim(), description: String(description || '').trim() },
  });
}

/** 管理员板块队列。 */
export function fetchPendingBoards({ cursor = '' } = {}) {
  return request(withQuery('/admin/queues/board', { cursor }));
}

/** 板块审核决定由服务端校验身份、版本和状态。 */
export function decideBoard(id, { decision, reason = '', expectedVersion }) {
  return request(withPath(endpoints.adminBoardDecision, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export default { fetchBoards, fetchBoardDetail, submitBoard, fetchPendingBoards, decideBoard };
