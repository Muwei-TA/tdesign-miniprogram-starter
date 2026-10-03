import Page from '~/utils/themed-page';
import { fetchBoardDetail } from '~/services/boards';
import { previewPostImage } from '~/services/image-preview';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

function sessionScope(session) {
  return session ? [session.user && session.user.id, session.club && session.club.id, session.role, session.memberStatus].join(':') : '';
}

function showAnonymousNotice() {
  wx.showModal({
    title: '树洞身份',
    content: '这条内容以树洞身份发布，其他人看不到作者的昵称与头像。这不是绝对匿名——具体经历、地名与文风仍可能让人猜到。',
    showCancel: false,
    confirmText: '我知道了',
  });
}

Page({
  data: {
    id: '',
    board: null,
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    canPost: false,
    isMember: false,
    loading: true,
    stale: false,
    errorText: '',
    errorKind: '',
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      const changed = this.sessionScope !== sessionScope(session);
      this.syncSession(session);
      if (changed) {
        this.boardRequestId = (this.boardRequestId || 0) + 1;
        this.boardFirstPageLoading = false;
        this.setData({
          board: null,
          list: [],
          canPost: false,
          loading: this.data.isMember,
          loadingMore: false,
          nextCursor: null,
          hasMore: false,
          errorText: '',
          errorKind: '',
        });
        if (this.data.isMember) this.loadDetail();
      }
    };
    app.eventBus.on('session-changed', this.onSessionChanged);

    if (!this.data.id) {
      this.setData({ loading: false, errorText: '当前板块不可访问', errorKind: 'not_accessible' });
    } else if (this.data.isMember) {
      this.loadDetail();
    } else {
      this.setData({ loading: false });
    }
  },

  onUnload() {
    this.boardRequestId = (this.boardRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    const request = this.data.isMember ? this.loadDetail() : Promise.resolve();
    request.finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadDetail({ append: true });
  },

  syncSession(session) {
    if (!session) return;
    this.setData({ isMember: session.memberStatus === 'active' });
    this.sessionScope = sessionScope(session);
  },

  async loadDetail({ append = false } = {}) {
    if (!this.data.id || !this.data.isMember) return;
    if (append && (this.data.loading || this.boardFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.boardRequestId || 0) + 1;
    this.boardRequestId = requestId;
    if (append) this.setData({ loadingMore: true });
    else {
      this.boardFirstPageLoading = true;
      this.setData({ loading: true, loadingMore: false, errorText: '', errorKind: '' });
    }

    try {
      const data = (await fetchBoardDetail(this.data.id, append ? this.data.nextCursor : '')) || {};
      if (requestId !== this.boardRequestId) return;
      if (!append) this.boardFirstPageLoading = false;
      const board = data.board || null;
      if (!board) {
        const err = new Error('当前板块不可访问');
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
      if (!append) {
        patch.board = board;
        patch.canPost = board.status === 'active' && !!data.canPost;
      }
      this.setData(patch);
    } catch (err) {
      if (requestId !== this.boardRequestId) return;
      if (!append) this.boardFirstPageLoading = false;
      if (append) {
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false,
        stale: !!this.data.board || this.data.list.length > 0,
        errorText: err.message || '加载失败',
        errorKind: err.kind || '',
      });
    }
  },

  onWrite() {
    const { board, canPost } = this.data;
    if (!this.data.isMember) {
      this.askJoin();
      return;
    }
    if (!board) return;
    if (board.status !== 'active') {
      wx.showToast({
        title: board.status === 'pending' ? '板块正在等待审核' : '当前板块暂不能发帖',
        icon: 'none',
      });
      return;
    }
    if (!canPost) {
      wx.showToast({ title: '当前不能在此发帖', icon: 'none' });
      return;
    }
    navigateTo(`/pages/release/index?boardId=${encodeURIComponent(this.data.id)}&boardTitle=${encodeURIComponent(board.title || '')}`);
  },

  onTapBody(e) {
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(e.detail.id)}&from=board`);
  },

  onTapMedia(e) {
    const { id, index, type } = e.detail;
    if (type === 'image') {
      previewPostImage(id, index);
      return;
    }
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(id)}&from=board`);
  },

  onTapAuthor(e) {
    const { userId, isAnonymous } = e.detail;
    if (isAnonymous || !userId) {
      showAnonymousNotice();
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${encodeURIComponent(userId)}`);
  },

  onTapTopic(e) {
    if (e.detail.topicId) navigateTo(`/pages/community/topic/index?id=${encodeURIComponent(e.detail.topicId)}`);
  },

  onTapBoard(e) {
    const boardId = e.detail.boardId || e.detail.id;
    if (boardId && boardId !== this.data.id) {
      navigateTo(`/pages/community/board/index?id=${encodeURIComponent(boardId)}`);
    }
  },

  onRetry() {
    this.loadDetail();
  },

  onJoinTap() {
    this.askJoin();
  },

  askJoin() {
    wx.showModal({
      title: '需要成员资格',
      content: this.data.clubTheme === 'blackbox'
        ? '加入当前社团后，可以浏览已开放的板块并在其中发布内容。'
        : '加入文学社后，可以浏览已开放的板块并在其中发帖。',
      confirmText: '去了解',
      success: (res) => {
        if (res.confirm) navigateTo('/pages/community/join/index?from=board');
      },
    });
  },
});
