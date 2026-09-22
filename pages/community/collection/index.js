import { fetchCollectionDetail } from '~/services/collections';
import { getCapabilities, getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    id: '',
    collection: null,
    entries: [],
    canSubmit: false,
    isMember: false,
    anthologyEnabled: false,
    loading: true,
    stale: false,
    unavailable: false,
    errorText: '',
    errorKind: '',
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      const wasEnabled = this.data.anthologyEnabled;
      this.syncSession(session);
      if (wasEnabled !== this.data.anthologyEnabled || this.data.anthologyEnabled) this.loadDetail();
    };
    app.eventBus.on('session-changed', this.onSessionChanged);

    if (this.data.id) this.loadDetail();
    else this.setData({ loading: false, unavailable: true });
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    this.loadDetail().then(() => wx.stopPullDownRefresh());
  },

  syncSession(session) {
    if (!session) return;
    this.setData({
      isMember: session.memberStatus === 'active',
      anthologyEnabled: getCapabilities().anthology === true,
    });
  },

  async loadDetail() {
    if (!this.data.id) return;
    if (getCapabilities().anthology !== true) {
      this.setData({
        loading: false,
        unavailable: true,
        collection: null,
        entries: [],
        canSubmit: false,
        errorText: '',
        stale: false,
      });
      return;
    }

    this.setData({ loading: true, unavailable: false, errorText: '', errorKind: '' });
    try {
      const data = (await fetchCollectionDetail(this.data.id)) || {};
      if (!data.collection) {
        const err = new Error('当前文集不可访问');
        err.kind = 'not_accessible';
        throw err;
      }
      this.setData({
        collection: data.collection || null,
        entries: data.entries || [],
        canSubmit: !!data.canSubmit,
        loading: false,
        stale: false,
        errorText: '',
        errorKind: '',
      });
    } catch (err) {
      this.setData({
        loading: false,
        stale: !!this.data.collection,
        errorText: err.message || '加载失败',
        errorKind: err.kind || '',
      });
    }
  },

  onEntryTap(e) {
    const { postId } = e.currentTarget.dataset;
    if (!postId) return;
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(postId)}&from=collection`);
  },

  onSubmit() {
    const { collection, canSubmit } = this.data;
    if (!collection || !canSubmit) return;
    if (collection.visibility === 'public' && getCapabilities().publicScope !== true) {
      wx.showModal({
        title: '公开范围暂未开放',
        content: '当前账号还不能把文章发布为公开可见，因此暂不能向公开文集投稿。',
        showCancel: false,
      });
      return;
    }
    // 发布页负责正文、身份、范围和明确授权；这里只传文集 id。
    navigateTo(`/pages/release/index?mode=article&collectionId=${encodeURIComponent(collection.id)}`);
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=collection');
  },

  onRetry() {
    this.loadDetail();
  },
});
