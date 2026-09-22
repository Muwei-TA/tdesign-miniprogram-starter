import { fetchNotifications, markAllRead } from '~/services/notifications';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const TABS = [
  { value: 'reply', label: '回应' },
  { value: 'system', label: '系统' },
];

Page({
  data: {
    tabs: TABS,
    tab: 'reply',
    list: [],
    loading: true,
    errorText: '',
  },

  onLoad() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh());
  },

  async loadList() {
    this.setData({ loading: true, errorText: '' });
    try {
      const data = await fetchNotifications({ tab: this.data.tab });
      this.setData({ list: data.items || [], loading: false });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '加载失败' });
    }
  },

  onTabTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.tab) return;
    this.setData({ tab: value, list: [] }, () => this.loadList());
  },

  onItemTap(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((row) => row.id === id);
    if (!item) return;

    // 目标失效时给中性提示，不泄露原内容
    if (!item.target.accessible) {
      wx.showModal({
        title: '内容不可访问',
        content: '相关内容当前不可访问，可能已被作者调整范围或删除。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }

    if (item.target.type === 'post') {
      navigateTo(`/pages/community/post/index?id=${item.target.id}&from=notice`);
      return;
    }
    if (item.target.type === 'rules') {
      navigateTo('/pages/community/rules/index');
    }
  },

  async onReadAll() {
    try {
      await markAllRead();
      const patch = {};
      this.data.list.forEach((item, index) => {
        patch[`list[${index}].read`] = true;
      });
      this.setData(patch);
      app.setUnreadCount(0);
    } catch (err) {
      // 失败时不假装已同步
      wx.showToast({ title: err.message || '暂时没能同步', icon: 'none' });
    }
  },

  onRetry() {
    this.loadList();
  },
});
