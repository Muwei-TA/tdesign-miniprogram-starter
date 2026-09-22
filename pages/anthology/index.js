import { fetchCollections } from '~/services/collections';
import { getSession, getCapabilities } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

Page({
  data: {
    list: [],
    loading: true,
    errorText: '',
    stale: false,
    unavailable: false,
    isMember: false,
    anthologyEnabled: false,
  },

  onLoad() {
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      const wasEnabled = this.data.anthologyEnabled;
      this.syncSession(session);
      if (wasEnabled !== this.data.anthologyEnabled || this.data.anthologyEnabled) this.loadCollections();
    };
    getApp().eventBus.on('session-changed', this.onSessionChanged);
    this.loadCollections();
  },

  onUnload() {
    getApp().eventBus.off('session-changed', this.onSessionChanged);
  },

  syncSession(session) {
    if (!session) return;
    this.setData({
      isMember: session.memberStatus === 'active',
      anthologyEnabled: getCapabilities().anthology === true,
    });
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
    if (getCapabilities().anthology !== true) {
      this.setData({ loading: false, unavailable: true, list: [], errorText: '', stale: false });
      return;
    }
    this.setData({ loading: true, errorText: '' });
    try {
      const data = await fetchCollections();
      this.setData({ list: data.items || [], loading: false, unavailable: false, stale: false });
    } catch (err) {
      this.setData({
        loading: false,
        unavailable: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '加载失败',
      });
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
