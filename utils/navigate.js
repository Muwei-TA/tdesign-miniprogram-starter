/**
 * 导航封装。
 *
 * 作用：部分页面（P03/P07/P10/P15/P18）尚未实现（见 docs/11-task-board.md），
 * 直接 wx.navigateTo 会静默失败。这里统一捕获失败并给出明确提示，避免"点了没反应"。
 *
 * 对应任务完成后，实现方可以直接删除 PENDING_PAGES 中自己的条目；
 * 全部实现后本文件可退化为纯 wx.navigateTo 包装。
 */
const PENDING_PAGES = {
};

function pathOf(url) {
  return String(url).split('?')[0];
}

function withClubContext(url) {
  const value = String(url);
  if (!pathOf(value).startsWith('/pages/community/')
    || pathOf(value) === '/pages/community/clubs/index'
    || /[?&]clubId=/.test(value)
    || typeof getApp !== 'function') return value;
  const app = getApp();
  const clubId = app && app.globalData && app.globalData.session
    && app.globalData.session.club && app.globalData.session.club.id;
  if (!clubId) return value;
  return `${value}${value.includes('?') ? '&' : '?'}clubId=${encodeURIComponent(clubId)}`;
}

export function navigateTo(url) {
  const targetUrl = withClubContext(url);
  const pending = PENDING_PAGES[pathOf(targetUrl)];
  if (pending) {
    wx.showToast({ title: `${pending} 待实现`, icon: 'none', duration: 2000 });
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    wx.navigateTo({
      url: targetUrl,
      success: () => resolve(true),
      fail: () => {
        wx.showToast({ title: '这个页面暂时打不开', icon: 'none' });
        resolve(false);
      },
    });
  });
}

export function redirectTo(url) {
  const targetUrl = withClubContext(url);
  return new Promise((resolve) => {
    wx.redirectTo({ url: targetUrl, success: () => resolve(true), fail: () => resolve(false) });
  });
}

export default { navigateTo, redirectTo };
