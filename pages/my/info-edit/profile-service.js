import request from '~/api/request';

/** 文字昵称真实保存；头像上传需等 media 能力开启后再接入。 */
export function updateMyProfile(displayName) {
  return request('/me/profile', { method: 'PATCH', data: { displayName } });
}
