import { fetchCollections } from '~/services/collections';
import { getSession, getCapabilities } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

Page({
  data: {
    list: [],
    loading: true,
    errorText: '',
    isMember: false,
    anthologyEnabled: false,
  },

  onLoad() {
    const session = getSession();
    this.setData({
      isMember: session.memberStatus === 'active',
      anthologyEnabled: getCapabilities().anthology,
    });
    this.loadCollections();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'anthology' });
    }
  },

  onPullDownRefresh() {
    this.loadCollections().then(() => wx.stopPullDownRefresh());
  },

  async loadCollections() {
    this.setData({ loading: true, errorText: '' });
    try {
      const data = await fetchCollections();
      this.setData({ list: data.items || [], loading: false });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '加载失败' });
    }
  },

  onCollectionTap(e) {
    navigateTo(`/pages/community/collection/index?id=${e.detail.id}`);
  },

  onWriteArticle() {
    navigateTo('/pages/release/index?mode=article');
  },

  onRetry() {
    this.loadCollections();
  },
});
