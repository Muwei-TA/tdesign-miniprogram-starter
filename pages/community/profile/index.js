import { fetchProfile } from '../profile-service';
import { previewPostImage } from '~/services/image-preview';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

function showAnonymousNotice() {
  wx.showModal({
    title: '树洞身份',
    content:
      '匿名内容不会出现在社员主页。其他人看不到作者的昵称与头像，这不是绝对匿名，请发布前检查具体经历与画面信息。',
    showCancel: false,
    confirmText: '我知道了',
  });
}

Page({
  data: {
    userId: '',
    user: null,
    memberStatusText: '',
    visibleCount: 0,
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loading: true,
    stale: false,
    errorText: '',
    errorKind: '',
  },

  onLoad(options) {
    this.setData({ userId: options.userId || '' });
    this.onSessionChanged = () => this.loadProfile();
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (this.data.userId) this.loadProfile();
    else this.setData({ loading: false, errorText: '当前主页不可访问', errorKind: 'not_accessible' });
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    this.loadProfile().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadProfile({ append: true });
  },

  async loadProfile({ append = false } = {}) {
    if (!this.data.userId) return;
    if (append && (this.data.loading || this.profileFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.profileRequestId || 0) + 1;
    this.profileRequestId = requestId;
    if (append) this.setData({ loadingMore: true });
    else {
      this.profileFirstPageLoading = true;
      this.setData({ loading: true, loadingMore: false, errorText: '', errorKind: '' });
    }
    try {
      const data = (await fetchProfile(this.data.userId, append ? this.data.nextCursor : '')) || {};
      if (requestId !== this.profileRequestId) return;
      if (!append) this.profileFirstPageLoading = false;
      if (!data.user) {
        const err = new Error('当前主页不可访问');
        err.kind = 'not_accessible';
        throw err;
      }
      const patch = {
        list: append ? this.data.list.concat(data.items || []) : data.items || [],
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
        errorKind: '',
      };
      // 头部信息与可见计数只在首屏读取时更新
      if (!append) {
        patch.user = data.user || null;
        patch.memberStatusText = data.memberStatusText || '';
        patch.visibleCount = Number(data.visibleCount) || 0;
      }
      this.setData(patch);
    } catch (err) {
      if (requestId !== this.profileRequestId) return;
      if (!append) this.profileFirstPageLoading = false;
      if (append) {
        // 追加失败不破坏已有列表
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false,
        stale: !!this.data.user || this.data.list.length > 0,
        errorText: err.message || '加载失败',
        errorKind: err.kind || '',
      });
    }
  },

  onTapName(e) {
    const { userId } = e.detail;
    if (userId && userId !== this.data.userId)
      navigateTo(`/pages/community/profile/index?userId=${encodeURIComponent(userId)}`);
  },

  onTapBody(e) {
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(e.detail.id)}`);
  },

  onTapMedia(e) {
    const { id, index, type } = e.detail;
    if (type === 'image') {
      previewPostImage(id, index);
      return;
    }
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(id)}`);
  },

  onTapTopic(e) {
    navigateTo(`/pages/community/topic/index?id=${encodeURIComponent(e.detail.topicId)}`);
  },

  onTapAuthor(e) {
    const { userId, isAnonymous } = e.detail;
    if (isAnonymous || !userId) {
      showAnonymousNotice();
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${encodeURIComponent(userId)}`);
  },

  onRetry() {
    this.loadProfile();
  },
});
