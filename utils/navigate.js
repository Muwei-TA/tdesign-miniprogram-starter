/**
 * 导航封装。
 *
 * 作用：部分页面（P03/P07/P10/P12/P14/P15/P16/P18）尚未实现（见 docs/11-task-board.md），
 * 直接 wx.navigateTo 会静默失败。这里统一捕获失败并给出明确提示，避免"点了没反应"。
 *
 * 对应任务完成后，实现方可以直接删除 PENDING_PAGES 中自己的条目；
 * 全部实现后本文件可退化为纯 wx.navigateTo 包装。
 */
const PENDING_PAGES = {
  '/pages/community/topic/index': 'P03 话题详情（任务 T-07）',
  '/pages/community/collection/index': 'P07 文集目录（任务 T-08）',
  '/pages/community/my-content/index': 'P10 我的内容列表（任务 T-09）',
  '/pages/community/join/index': 'P12 加入文学社（任务 T-11）',
  '/pages/community/club/index': 'P14 社团名片（任务 T-11）',
  '/pages/community/rules/index': 'P16 社区约定（任务 T-12）',
  '/pages/community/profile/index': 'P18 社员主页（任务 T-14）',
  '/pages/admin/index': 'P15 社团管理台（任务 T-13）',
};

function pathOf(url) {
  return String(url).split('?')[0];
}

export function navigateTo(url) {
  const pending = PENDING_PAGES[pathOf(url)];
  if (pending) {
    wx.showToast({ title: `${pending} 待实现`, icon: 'none', duration: 2000 });
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    wx.navigateTo({
      url,
      success: () => resolve(true),
      fail: () => {
        wx.showToast({ title: '这个页面暂时打不开', icon: 'none' });
        resolve(false);
      },
    });
  });
}

export function redirectTo(url) {
  return new Promise((resolve) => {
    wx.redirectTo({ url, success: () => resolve(true), fail: () => resolve(false) });
  });
}

export default { navigateTo, redirectTo };
