import request, { withQuery } from '~/api/request';

/** 社员主页只读取服务端按当前会话过滤后的署名作品。 */
export function fetchProfile(targetUserId, cursor = '') {
  return request(withQuery(`/profile/${encodeURIComponent(targetUserId)}`, { cursor }));
}
