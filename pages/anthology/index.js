import {
  fetchFeed,
  toggleReaction,
  toggleBookmark,
  shrinkVisibility,
  deletePost,
} from '~/services/posts';
import { previewPostImage } from '~/services/image-preview';
import { getCapabilities, getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

/** 列表仅把首图交给卡片，图片点击仍由 previewPostImage 重新鉴权。 */
function prepareArticlePost(post) {
  if (!post) return post;
  const media = post.media || {};
  if (media.type !== 'image') return post;
  return {
    ...post,
    media: { ...media, images: (media.images || []).slice(0, 1) },
  };
}

Page({
  data: {
    list: [],
    nextCursor: null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    stale: false,
    errorText: '',
    isMember: false,
    canPublish: false,
    capabilities: { publicScope: false },
    scopeVisible: false,
    scopeValue: 'club',
    actionPost: null,
  },

  onLoad() {
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      this.syncSession(session);
      this.loadFeed({ silent: true });
    };
    this.onPostChanged = () => this.loadFeed({ silent: true });
    app.eventBus.on('session-changed', this.onSessionChanged);
    app.eventBus.on('post-changed', this.onPostChanged);
    app.eventBus.on('post-created', this.onPostChanged);
    this.loadFeed();
  },

  onUnload() {
    this.feedRequestId = (this.feedRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
    app.eventBus.off('post-changed', this.onPostChanged);
    app.eventBus.off('post-created', this.onPostChanged);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'anthology' });
    }
    if (this.hasShownOnce) this.loadFeed({ silent: true });
    this.hasShownOnce = true;
  },

  onPullDownRefresh() {
    this.loadFeed().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadFeed({ append: true });
  },

  syncSession(session) {
    if (!session) return;
    const capabilities = session.capabilities || getCapabilities() || {};
    const isMember = session.memberStatus === 'active';
    this.setData({
      isMember,
      canPublish: isMember && capabilities.publishing === true,
      capabilities,
    });
  },

  async loadFeed({ silent = false, append = false } = {}) {
    if (append && (this.data.loading || this.feedFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;

    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    if (append) {
      this.setData({ loadingMore: true });
    } else {
      this.feedFirstPageLoading = true;
      this.setData(silent
        ? { loadingMore: false, errorText: '' }
        : { loading: true, loadingMore: false, errorText: '' });
    }

    try {
      const data = await fetchFeed({
        filter: 'article',
        cursor: append ? this.data.nextCursor : '',
      });
      if (requestId !== this.feedRequestId) return;
      if (!append) this.feedFirstPageLoading = false;
      const items = (data.items || []).map(prepareArticlePost);
      this.setData({
        list: append ? this.data.list.concat(items) : items,
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.feedRequestId) return;
      if (!append) this.feedFirstPageLoading = false;
      if (append) {
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

  onRetry() {
    this.loadFeed();
  },

  onWriteArticle() {
    if (!this.data.canPublish) {
      wx.showToast({ title: '当前账号暂不能发布文稿', icon: 'none' });
      return;
    }
    navigateTo('/pages/release/index?mode=article');
  },

  onTapBody(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(id)}&from=feed`);
  },

  onTapMedia(e) {
    const { id, index, type } = e.detail || {};
    if (!id) return;
    if (type === 'image') {
      previewPostImage(id, index);
      return;
    }
    this.onTapBody({ detail: { id } });
  },

  onTapTopic(e) {
    const topicId = e.detail && e.detail.topicId;
    if (topicId) navigateTo(`/pages/community/topic/index?id=${encodeURIComponent(topicId)}`);
  },

  onTapBoard(e) {
    const boardId = e.detail && (e.detail.boardId || e.detail.id);
    if (boardId) navigateTo(`/pages/community/board/index?id=${encodeURIComponent(boardId)}`);
  },

  onTapAuthor(e) {
    const { userId, isAnonymous } = e.detail || {};
    if (isAnonymous || !userId) {
      wx.showModal({
        title: '树洞身份',
        content: '这篇文稿以树洞身份发布，其他人看不到作者的昵称与头像。具体经历、地名与文风仍可能让人猜到。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${encodeURIComponent(userId)}`);
  },

  onMore(e) {
    const post = this.data.list.find((item) => item.id === e.detail.id);
    const viewer = post && post.viewer ? post.viewer : {};
    if (!post || !viewer.isOwner) return;

    const actions = [];
    if (viewer.canShrinkVisibility) actions.push({ key: 'shrink', label: '缩小可见范围' });
    if (viewer.canDelete) actions.push({ key: 'delete', label: '删除' });
    if (actions.length === 0) return;

    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: ({ tapIndex }) => {
        const action = actions[tapIndex];
        if (!action) return;
        if (action.key === 'shrink') {
          this.setData({ actionPost: post, scopeValue: post.visibility, scopeVisible: true });
          return;
        }
        this.confirmDeletePost(post);
      },
    });
  },

  onScopeClose() {
    this.setData({ scopeVisible: false, actionPost: null });
  },

  onScopeChange(e) {
    const post = this.data.actionPost;
    const visibility = e.detail.value;
    const allowedTargets = {
      public: ['club', 'private'],
      club: ['private'],
      private: [],
    };
    const viewer = post && post.viewer ? post.viewer : {};
    this.setData({ scopeVisible: false });

    if (
      !post ||
      !viewer.isOwner ||
      !viewer.canShrinkVisibility ||
      !(allowedTargets[post.visibility] || []).includes(visibility)
    ) {
      this.setData({ actionPost: null });
      wx.showToast({ title: '只能选择更小的可见范围', icon: 'none' });
      return;
    }
    if (!Number.isInteger(post.version)) {
      this.setData({ actionPost: null });
      wx.showToast({ title: '内容已更新，请刷新后重试', icon: 'none' });
      this.loadFeed({ silent: true });
      return;
    }

    const labelMap = { club: '仅社内可见', private: '只有自己可见' };
    wx.showModal({
      title: '缩小可见范围',
      content: `改为「${labelMap[visibility]}」后，原受众将无法再看到这篇文稿。已经保存的截图无法追回。`,
      confirmText: '确认缩小',
      success: async (res) => {
        if (!res.confirm) {
          this.setData({ actionPost: null });
          return;
        }
        try {
          await shrinkVisibility(post.id, visibility, post.version);
          this.removePostAndRefresh(post.id, 'visibility');
          wx.showToast({ title: '已更新可见范围', icon: 'none' });
        } catch (err) {
          this.setData({ actionPost: null });
          wx.showToast({ title: err.message || '未能更新', icon: 'none' });
          this.loadFeed({ silent: true });
        }
      },
    });
  },

  confirmDeletePost(post) {
    const viewer = post && post.viewer ? post.viewer : {};
    if (!post || !viewer.isOwner || !viewer.canDelete) return;
    if (!Number.isInteger(post.version)) {
      wx.showToast({ title: '内容已更新，请刷新后重试', icon: 'none' });
      this.loadFeed({ silent: true });
      return;
    }

    wx.showModal({
      title: '删除这篇文稿',
      content: '删除后无法恢复，相关回应也会一并停止展示。',
      confirmText: '删除',
      confirmColor: '#A85648',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deletePost(post.id, post.version);
          this.removePostAndRefresh(post.id, 'delete');
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err.message || '未能删除', icon: 'none' });
          this.loadFeed({ silent: true });
        }
      },
    });
  },

  removePostAndRefresh(id, action) {
    this.setData({
      list: this.data.list.filter((item) => item.id !== id),
      actionPost: null,
      scopeVisible: false,
    });
    app.eventBus.emit('post-changed', { id, action });
  },

  async onReact(e) {
    if (!this.data.isMember) return;
    await this.optimistic(e.detail.id, 'reacted', e.detail.next, 'reactions', toggleReaction, 'react');
  },

  async onBookmark(e) {
    if (!this.data.isMember) return;
    await this.optimistic(e.detail.id, 'bookmarked', e.detail.next, null, toggleBookmark, 'bookmark');
  },

  /** 乐观更新并回滚失败结果；服务端仍负责最终的成员权限校验。 */
  async optimistic(id, flagKey, next, counterKey, action, actionName) {
    this.interactionBusy = this.interactionBusy || {};
    const busyKey = `${id}:${flagKey}`;
    if (this.interactionBusy[busyKey]) return;
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;

    this.interactionBusy[busyKey] = true;
    const post = this.data.list[index];
    const viewer = post.viewer || {};
    const prevFlag = !!viewer[flagKey];
    const prevCount = counterKey ? post.counters[counterKey] || 0 : null;
    const patch = { [`list[${index}].viewer.${flagKey}`]: next };
    if (counterKey) patch[`list[${index}].counters.${counterKey}`] = Math.max(0, prevCount + (next ? 1 : -1));
    this.setData(patch);

    try {
      await action(id, next);
      app.eventBus.emit('post-changed', { id, action: actionName });
    } catch (err) {
      const currentIndex = this.data.list.findIndex((item) => item.id === id);
      if (currentIndex >= 0) {
        const rollback = { [`list[${currentIndex}].viewer.${flagKey}`]: prevFlag };
        if (counterKey) rollback[`list[${currentIndex}].counters.${counterKey}`] = prevCount;
        this.setData(rollback);
      }
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    } finally {
      this.interactionBusy[busyKey] = false;
    }
  },
});
