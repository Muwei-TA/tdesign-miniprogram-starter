import { fetchPostDetail } from '~/services/posts';

const ACCESS_MESSAGE = '图片当前不可访问，请返回刷新内容';
const LOAD_MESSAGE = '图片刷新失败，请检查网络后重试';
const PREVIEW_MESSAGE = '图片打开失败，请稍后重试';

function showMessage(title) {
  wx.showToast({ title, icon: 'none', duration: 2200 });
}

function messageForFetchError(error) {
  if (['not_accessible', 'membership_invalid', 'forbidden', 'unauthenticated'].includes(error && error.kind)) {
    return ACCESS_MESSAGE;
  }
  return LOAD_MESSAGE;
}

/** Re-authorize a post and obtain fresh signed image URLs at preview time. */
export async function previewPostImage(postId, imageIndex) {
  const id = String(postId || '').trim();
  const indexText = imageIndex === undefined || imageIndex === null ? '' : String(imageIndex).trim();
  const index = Number(indexText);
  if (!id || !/^\d+$/.test(indexText) || !Number.isInteger(index) || index < 0) {
    showMessage(ACCESS_MESSAGE);
    return false;
  }

  try {
    const post = await fetchPostDetail(id);
    const images = post && post.media && Array.isArray(post.media.images)
      ? post.media.images
      : [];
    const current = images[index];
    const urls = images.filter((url) => typeof url === 'string' && url.trim());

    if (typeof current !== 'string' || !current.trim() || !urls.includes(current)) {
      showMessage(ACCESS_MESSAGE);
      return false;
    }

    wx.previewImage({
      current,
      urls,
      fail: () => showMessage(PREVIEW_MESSAGE),
    });
    return true;
  } catch (error) {
    showMessage(messageForFetchError(error));
    return false;
  }
}

export default { previewPostImage };
