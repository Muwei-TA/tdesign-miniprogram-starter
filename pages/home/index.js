import { fetchFeed, toggleReaction, toggleBookmark, FEED_FILTERS } from '~/services/posts';
import { previewPostImage } from '~/services/image-preview';
import config from '~/config';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    isMock: config.isMock,
    filters: FEED_FILTERS,
    filter: 'all',
    list: [],
    weekPrompt: null,
    club: null,
    loading: true,
    // stale：请求失败但保留了已加载数据，顶部提示"未更新"
    stale: false,
    errorText: '',
    unread: 0,
    isMember: false,
    navTools: [
      { key: 'notice', icon: 'notification', badge: false, label: '消息' },
      { key: 'search', icon: 'search', badge: false, label: '搜索' },
    ],
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
  },

  onPullDownRefresh() {
    this.loadFeed().then(() => wx.stopPullDownRefresh());
  },

  syncSession(session) {
    if (!session) return;
    this.setData({ isMember: session.memberStatus === 'active' });
  },

  setUnread(count) {
    this.setData({
      unread: count,
      navTools: [
        { key: 'notice', icon: 'notification', badge: count > 0, label: '消息' },
        { key: 'search', icon: 'search', badge: false, label: '搜索' },
      ],
    });
  },

  async loadFeed({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true, errorText: '' });
    try {
      const data = await fetchFeed({ filter: this.data.filter });
      this.setData({
        list: data.items || [],
        weekPrompt: data.weekPrompt || null,
        club: data.club || null,
        loading: false,
        stale: false,
        errorText: '',
      });
      this.setUnread(app.globalData.unreadCount || 0);
    } catch (err) {
      // 失败时保留已加载数据，只提示未更新（docs/08 P01）
      this.setData({
        loading: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '加载失败',
      });
    }
  },

  onFilterTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.filter) return;
    // 切换筛选重置游标
    this.setData({ filter: value, list: [] }, () => this.loadFeed());
  },

  onRetry() {
    this.loadFeed();
  },

  onNavTool(e) {
    const { key } = e.detail;
    if (key === 'notice') wx.navigateTo({ url: '/pages/message/index' });
    if (key === 'search') wx.navigateTo({ url: '/pages/search/index' });
  },

  onSearchTap() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  onClubTap() {
    navigateTo('/pages/community/club/index');
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
