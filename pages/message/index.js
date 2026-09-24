import { fetchNotifications, markAllRead } from '~/services/notifications';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const TABS = [
  { value: 'reply', label: '回应' },
  { value: 'system', label: '系统' },
];

const ADMIN_QUEUES = ['content', 'comment', 'topic', 'member', 'report', 'collection'];

Page({
  data: {
    tabs: TABS,
    tab: 'reply',
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loading: true,
    stale: false,
    errorText: '',
  },

  onLoad() {
    this.hasShownOnce = false;
    this.loadList();
  },

  onShow() {
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    this.loadList();
    const { session } = app.globalData;
    if (session && session.role !== 'guest') return app.refreshUnreadCount();
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadList({ append: true });
  },

  async loadList({ append = false } = {}) {
    if (append && (this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.listRequestId || 0) + 1;
    this.listRequestId = requestId;
    const { tab } = this.data;
    this.setData(append ? { loadingMore: true } : { loading: true, stale: false, errorText: '' });
    try {
      const data = await fetchNotifications({ tab, cursor: append ? this.data.nextCursor : '' });
      if (requestId !== this.listRequestId) return;
      this.setData({
        list: append ? this.data.list.concat(data.items || []) : data.items || [],
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.listRequestId) return;
      if (append) {
        // 追加失败不破坏已有列表
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '加载失败',
      });
    }
  },

  onTabTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.tab) return;
    this.setData({ tab: value, list: [], nextCursor: null, hasMore: false, stale: false, errorText: '' }, () =>
      this.loadList(),
    );
  },

  onItemTap(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((row) => row.id === id);
    if (!item) return;

    const { target } = item;
    // 目标失效时给中性提示，不泄露原内容
    if (!target || typeof target !== 'object' || target.accessible !== true) {
      wx.showModal({
        title: '内容不可访问',
        content: '相关内容当前不可访问，可能已被作者调整范围或删除。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }

    if (target.type === 'admin_queue') {
      if (this.data.tab !== 'system' || !ADMIN_QUEUES.includes(target.queue) || target.id !== target.queue) return;
      navigateTo(`/pages/admin/index?queue=${target.queue}`);
      return;
    }
    if (target.type === 'admin_appeals') {
      if (this.data.tab !== 'system' || target.queue !== 'appeals' || target.id !== 'appeals') return;
      navigateTo('/pages/admin/appeals/index');
      return;
    }
    if (target.type === 'post' && typeof target.id === 'string' && target.id) {
      navigateTo(`/pages/community/post/index?id=${encodeURIComponent(target.id)}&from=notice`);
      return;
    }
    if (target.type === 'rules') {
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
