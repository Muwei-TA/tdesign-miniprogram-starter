import request, { withQuery } from '~/api/request';

/**
 * 社员主页只读取服务端按当前会话过滤后的署名作品。
 * `targetUserId` 来自服务端 author.userId，匿名作者不会进入这里。
 */
export function fetchProfile(targetUserId, cursor = '') {
  return request(withQuery(`/profile/${encodeURIComponent(targetUserId)}`, { cursor }));
}

/** 文字昵称真实保存；头像上传需等 media 能力开启后再接入。 */
export function updateMyProfile(displayName) {
  return request('/me/profile', { method: 'PATCH', data: { displayName } });
}

export default { fetchProfile, updateMyProfile };
