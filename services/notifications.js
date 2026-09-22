import request, { withQuery } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 站内通知。文案必须中性：不含匿名映射、私密正文与原始图片。
 * 渲染前需复核 target 可访问性，失效显示中性占位。
 */
export function fetchNotifications({ tab = 'reply', cursor = '' } = {}) {
  return request(withQuery(endpoints.notifications, { tab, cursor }));
}

export function markAllRead() {
  return request(endpoints.notificationsReadAll, { method: 'POST' });
}

export async function fetchUnreadCount() {
  const data = await request(endpoints.notificationsUnread);
  return (data && data.count) || 0;
}

export default { fetchNotifications, markAllRead, fetchUnreadCount };
