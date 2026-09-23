import { scopedKey } from '~/services/session';

const INDEX_KEY = 'draft-index';

function readIndex() {
  return wx.getStorageSync(scopedKey(INDEX_KEY)) || [];
}

/** 只在“我的内容”页读取当前账号的本机草稿。 */
export function listDrafts() {
  return readIndex();
}

export function removeDraft(id) {
  wx.removeStorageSync(scopedKey(`draft:${id}`));
  wx.setStorageSync(scopedKey(INDEX_KEY), readIndex().filter((item) => item.id !== id));
}
