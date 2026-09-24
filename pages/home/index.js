import {
  fetchFeed,
  toggleReaction,
  toggleBookmark,
  shrinkVisibility,
  deletePost,
  FEED_FILTERS,
} from '~/services/posts';
import { previewPostImage } from '~/services/image-preview';
import { getCapabilities, getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    filters: FEED_FILTERS,
    filter: 'all',
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    weekPrompt: null,
    club: null,
    loading: true,
    // stale：请求失败但保留了已加载数据，顶部提示"未更新"
    stale: false,
    errorText: '',
    unread: 0,
    isMember: false,
    scopeVisible: false,
    scopeValue: 'club',
    actionPost: null,
    capabilities: { publicScope: false },
  },

  onLoad() {
    this.syncSession(getSession());
    this.loadFeed();

    this.onSessionChanged = (session) => this.syncSession(session);
    this.onUnreadChanged = (count) => this.setUnread(count);
    this.onPostChanged = () => this.loadFeed({ silent: true });

    app.eventBus.on('session-changed', this.onSessionChanged);
    app.eventBus.on('notice-unread-change', this.onUnreadChanged);
    app.eventBus.on('post-changed', this.onPostChanged);
    app.eventBus.on('post-created', this.onPostChanged);
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
    app.eventBus.off('notice-unread-change', this.onUnreadChanged);
    app.eventBus.off('post-changed', this.onPostChanged);
    app.eventBus.off('post-created', this.onPostChanged);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'home' });
    }
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    const { session } = app.globalData;
    if (session && session.role !== 'guest') return app.refreshUnreadCount();
  },

  onPullDownRefresh() {
    this.loadFeed().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadFeed({ append: true });
  },

  syncSession(session) {
    if (!session) return;
    this.setData({
      isMember: session.memberStatus === 'active',
      capabilities: getCapabilities(),
    });
  },

  setUnread(count) {
    this.setData({ unread: count });
  },

  async loadFeed({ silent = false, append = false } = {}) {
    if (append && (this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    const { filter } = this.data;
    if (!silent || append) {
      this.setData(append ? { loadingMore: true } : { loading: true, errorText: '' });
    }
    try {
      const data = await fetchFeed({ filter, cursor: append ? this.data.nextCursor : '' });
      // 快速切换筛选时，旧响应不得覆盖新筛选
      if (requestId !== this.feedRequestId) return;
      this.setData({
        list: append ? this.data.list.concat(data.items || []) : data.items || [],
        weekPrompt: data.weekPrompt || null,
        club: data.club || null,
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
      });
      this.setUnread(app.globalData.unreadCount || 0);
    } catch (err) {
      if (requestId !== this.feedRequestId) return;
      if (append) {
        // 追加失败不破坏已有列表
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      // 失败时保留已加载数据，只提示未更新（docs/08 P01）
      this.setData({
        loading: false,
        loadingMore: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '加载失败',
      });
    }
  },

  onFilterTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.filter) return;
    // 切换筛选重置游标
    this.setData({ filter: value, list: [], nextCursor: null, hasMore: false }, () => this.loadFeed());
  },

  onRetry() {
    this.loadFeed();
  },

  onNoticeTap() {
    wx.navigateTo({ url: '/pages/message/index' });
  },

  onSearchTap() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  onWeekTap() {
    const { weekPrompt } = this.data;
    if (!weekPrompt) return;
    navigateTo(`/pages/community/topic/index?id=${weekPrompt.topicId}`);
  },

  onTapBody(e) {
    wx.navigateTo({ url: `/pages/community/post/index?id=${e.detail.id}&from=feed` });
  },

  onTapMedia(e) {
    const { id, index, type } = e.detail;
    if (type === 'image') {
      previewPostImage(id, index);
      return;
    }
    // 视频统一在详情页播放，列表不自动播放
    wx.navigateTo({ url: `/pages/community/post/index?id=${id}&from=feed` });
  },

  onTapTopic(e) {
    navigateTo(`/pages/community/topic/index?id=${e.detail.topicId}`);
  },

  onTapAuthor(e) {
    const { userId, isAnonymous } = e.detail;
    if (isAnonymous || !userId) {
      // 匿名作者不进入真实主页，只解释树洞身份
      wx.showModal({
        title: '树洞身份',
        content: '这条内容以树洞身份发布，其他人看不到作者的昵称与头像。这不是绝对匿名——具体经历、地名与文风仍可能让人猜到。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${userId}`);
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
      content: `改为「${labelMap[visibility]}」后，原受众将无法再看到这条内容。已经保存的截图无法追回。`,
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
      title: '删除这条内容',
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
    await this.optimistic(e.detail.id, 'reacted', e.detail.next, 'reactions', toggleReaction);
  },

  async onBookmark(e) {
    await this.optimistic(e.detail.id, 'bookmarked', e.detail.next, null, toggleBookmark);
  },

  /** 乐观更新 + 失败回滚，避免误触后无反馈 */
  async optimistic(id, flagKey, next, counterKey, action) {
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const post = this.data.list[index];
    const prevFlag = post.viewer[flagKey];
    const prevCount = counterKey ? post.counters[counterKey] : null;

    const patch = { [`list[${index}].viewer.${flagKey}`]: next };
    if (counterKey) patch[`list[${index}].counters.${counterKey}`] = Math.max(0, prevCount + (next ? 1 : -1));
    this.setData(patch);

    try {
      await action(id, next);
    } catch (err) {
      const rollback = { [`list[${index}].viewer.${flagKey}`]: prevFlag };
      if (counterKey) rollback[`list[${index}].counters.${counterKey}`] = prevCount;
      this.setData(rollback);
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  },

  onCompose() {
    wx.navigateTo({ url: '/pages/release/index' });
  },
});
