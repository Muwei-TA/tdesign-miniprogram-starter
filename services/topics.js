import request, { withPath, withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

export const TOPIC_CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'life', label: '生活' },
  { value: 'reading', label: '阅读' },
  { value: 'inspiration', label: '灵感' },
  { value: 'confide', label: '倾诉' },
  { value: 'event', label: '活动' },
  { value: 'play', label: '共玩' },
];

export function fetchTopics({ category = 'all', cursor = '' } = {}) {
  return request(withQuery(endpoints.topics, { category: category === 'all' ? '' : category, cursor }));
}

export function fetchTopicDetail(id, cursor = '') {
  return request(withQuery(withPath(endpoints.topicDetail, { id }), { cursor }));
}

/** 社员提交话题 → pending；同名话题由服务端引导参与，不创建重复项 */
export function submitTopic({ title, description, category }) {
  return request(endpoints.topics, { method: 'POST', data: { title, description, category } });
}

/** 关注只是把话题存到"我的话题"，首版不发送站外通知 */
export function toggleFollow(id, next) {
  return request(withPath(endpoints.topicFollow, { id }), { method: next ? 'PUT' : 'DELETE' });
}

export default { TOPIC_CATEGORIES, fetchTopics, fetchTopicDetail, submitTopic, toggleFollow };
