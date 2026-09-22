import request, { withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 管理台五队列。注意：分包与前端隐藏都不是安全边界，接口必须由服务端按角色鉴权。
 * 普通管理员不可读私密手记与匿名映射；举报记录不暴露举报人。
 */

export const QUEUES = [
  { value: 'content', label: '内容' },
  { value: 'topic', label: '话题' },
  { value: 'member', label: '入社' },
  { value: 'report', label: '举报' },
  { value: 'collection', label: '文集' },
];

export function fetchQueue({ queue = 'content', cursor = '' } = {}) {
  return request(withQuery(withPath(endpoints.adminQueue, { queue }), { cursor }));
}

/** 退回/隐藏必须带理由；expectedVersion 用于并发版本锁，重复提交幂等 */
export function submitDecision(id, { decision, reason, expectedVersion }) {
  return request(withPath(endpoints.adminDecision, { id }), {
    method: 'POST',
    data: { decision, reason, expectedVersion },
  });
}

export function decideMembership(id, { decision, reason }) {
  return request(withPath(endpoints.adminMemberDecision, { id }), {
    method: 'POST',
    data: { decision, reason },
  });
}

export default { QUEUES, fetchQueue, submitDecision, decideMembership };
