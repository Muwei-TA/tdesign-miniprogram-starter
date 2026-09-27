import {
  fetchFeed,
  toggleReaction,
  toggleBookmark,
  shrinkVisibility,
  deletePost,
  FEED_FILTERS,
} from '~/services/posts';
import { fetchBoards } from '~/services/boards';
import { previewPostImage } from '~/services/image-preview';
import { getCapabilities, getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';
import { createHomeFeed } from './feed';
import { createHomePostActions } from './post-actions';

const app = getApp();
let homeFeed;
let homePostActions;

function getHomeFeed() {
  if (!homeFeed) {
    homeFeed = createHomeFeed({ fetchFeed, fetchBoards, FEED_FILTERS, getSession, app, wx });
  }
  return homeFeed;
}

function getHomePostActions() {
  if (!homePostActions) {
    homePostActions = createHomePostActions({
      shrinkVisibility, deletePost, toggleReaction, toggleBookmark, app, wx,
    });
  }
  return homePostActions;
}

Page({
  data: {
    filters: FEED_FILTERS,
    selectedBoardId: '',
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    recommendationCards: [],
    recommendationState: 'loading',
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

    this.onSessionChanged = (session) => {
      this.syncSession(session);
      this.loadRecommendations(session);
    };
    this.onUnreadChanged = (count) => this.setUnread(count);
    this.onPostChanged = () => this.loadFeed({ silent: true });

    app.eventBus.on('session-changed', this.onSessionChanged);
    app.eventBus.on('notice-unread-change', this.onUnreadChanged);
    app.eventBus.on('post-changed', this.onPostChanged);
    app.eventBus.on('post-created', this.onPostChanged);
    this.loadRecommendations(getSession());
  },

  onUnload() {
    this.recommendationRequestId = (this.recommendationRequestId || 0) + 1;
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
      // 首页 onLoad 已取推荐数据，首次 onShow 不重复请求。
      this.hasShownOnce = true;
      return;
    }
    this.loadRecommendations(getSession());
    const { session } = app.globalData;
    if (session && session.role !== 'guest') return app.refreshUnreadCount();
  },

  onPullDownRefresh() {
    Promise.all([this.loadFeed(), this.loadRecommendations()]).then(() => wx.stopPullDownRefresh());
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

  async loadRecommendations(session = getSession()) {
    return getHomeFeed().loadRecommendations.call(this, session);
  },

  async loadFeed({ silent = false, append = false } = {}) {
    return getHomeFeed().loadFeed.call(this, { silent, append });
  },

  onFilterTap(e) {
    return getHomeFeed().onFilterTap.call(this, e);
  },

  setBoardSelection(boardId) {
    return getHomeFeed().setBoardSelection.call(this, boardId);
  },

  resetFeedForBoard(boardId, patch = {}) {
    return getHomeFeed().resetFeedForBoard.call(this, boardId, patch);
  },

  onRetry() {
    return getHomeFeed().onRetry.call(this);
  },

  onNoticeTap() {
    wx.navigateTo({ url: '/pages/message/index' });
  },

  onRecommendationTap(e) {
    return getHomeFeed().onRecommendationTap.call(this, e);
  },

  onRecommendationOpen(e) {
    const { id } = e.currentTarget.dataset;
    if (id) navigateTo(`/pages/community/board/index?id=${encodeURIComponent(id)}`);
  },

  onMoreRecommendations() {
    navigateTo('/pages/community/boards/index');
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

  onTapBoard(e) {
    const id = e.detail.boardId || e.detail.id;
    if (id) navigateTo(`/pages/community/board/index?id=${encodeURIComponent(id)}`);
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
    return getHomePostActions().onMore.call(this, e);
  },

  onScopeClose() {
    return getHomePostActions().onScopeClose.call(this);
  },

  onScopeChange(e) {
    return getHomePostActions().onScopeChange.call(this, e);
  },

  confirmDeletePost(post) {
    return getHomePostActions().confirmDeletePost.call(this, post);
  },

  removePostAndRefresh(id, action) {
    return getHomePostActions().removePostAndRefresh.call(this, id, action);
  },

  async onReact(e) {
    return getHomePostActions().onReact.call(this, e);
  },

  async onBookmark(e) {
    return getHomePostActions().onBookmark.call(this, e);
  },

  /** 乐观更新 + 失败回滚，避免误触后无反馈 */
  async optimistic(id, flagKey, next, counterKey, action) {
    return getHomePostActions().optimistic.call(this, id, flagKey, next, counterKey, action);
  },

  onCompose() {
    wx.navigateTo({ url: '/pages/release/index' });
  },
});
