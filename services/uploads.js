import request, { withPath } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 媒体上传链路（骨架，完整实现见任务 T-15）。
 * 限制值来自 docs/01 1.5：图片 ≤9 张 / 单张 ≤10MB；视频 1 个 / ≤60s / ≤30MB。
 * 客户端校验只改善体验，服务端仍须二次校验类型、尺寸、元数据与内容。
 */

export const LIMITS = {
  imageCount: 9,
  imageSize: 10 * 1024 * 1024,
  videoCount: 1,
  videoSize: 30 * 1024 * 1024,
  videoDuration: 60,
};

/** 返回 { ok, message }，message 用于直接提示用户 */
export function validateImages(files = [], existingCount = 0) {
  if (existingCount + files.length > LIMITS.imageCount) {
    return { ok: false, message: `一条内容最多 ${LIMITS.imageCount} 张图片` };
  }
  const tooLarge = files.find((file) => (file.size || 0) > LIMITS.imageSize);
  if (tooLarge) return { ok: false, message: '单张图片不能超过 10MB' };
  return { ok: true };
}

export function validateVideo(file) {
  if (!file) return { ok: false, message: '未选择视频' };
  if ((file.size || 0) > LIMITS.videoSize) return { ok: false, message: '视频源文件不能超过 30MB' };
  if ((file.duration || 0) > LIMITS.videoDuration) return { ok: false, message: '视频时长请控制在 60 秒内' };
  return { ok: true };
}

/** 申请限时上传授权；实际文件仍由服务端二次校验 */
export function createUploadIntent({ mediaType, size, duration, mimeType }) {
  return request(endpoints.uploadIntents, {
    method: 'POST',
    data: { mediaType, size, duration, mimeType },
  });
}

/** 查询附件处理状态：verified 之后才能提交内容 */
export function fetchAssetStatus(id) {
  return request(withPath(endpoints.assetDetail, { id }));
}

export default { LIMITS, validateImages, validateVideo, createUploadIntent, fetchAssetStatus };
