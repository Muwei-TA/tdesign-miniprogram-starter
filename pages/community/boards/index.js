import { fetchBoards, submitBoard } from '~/services/boards';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    list: [],
    keyword: '',
    query: '',
    nextCursor: null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    stale: false,
    errorText: '',
    isMember: false,
    isAdmin: false,
    createVisible: false,
    title: '',
    titleCount: 0,
    description: '',
    descriptionCount: 0,
    canSubmit: false,
    submitting: false,
    createdBoardId: '',
    createdStatus: '',
    createdDuplicate: false,
  },

  onLoad() {
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      const wasMember = this.data.isMember;
      this.syncSession(session);
      if (!wasMember && this.data.isMember) this.loadBoards();
      if (wasMember && !this.data.isMember) {
        this.boardRequestId = (this.boardRequestId || 0) + 1;
        this.setData({
          list: [],
          loading: false,
          loadingMore: false,
          nextCursor: null,
          hasMore: false,
          createVisible: false,
          createdBoardId: '',
          createdStatus: '',
          createdDuplicate: false,
        });
      }
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (this.data.isMember) this.loadBoards();
    else this.setData({ loading: false });
  },

  onUnload() {
    this.boardRequestId = (this.boardRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    const request = this.data.isMember ? this.loadBoards() : Promise.resolve();
    request.finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadBoards({ append: true });
  },

  syncSession(session) {
    if (!session) return;
    this.setData({
      isMember: session.memberStatus === 'active',
      isAdmin: session.memberStatus === 'active' && ['admin', 'moderator'].includes(session.role),
    });
  },

  async loadBoards({ append = false } = {}) {
    if (!this.data.isMember) return;
    if (append && (this.data.loading || this.boardsFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.boardRequestId || 0) + 1;
    this.boardRequestId = requestId;
    const { query } = this.data;
    if (append) this.setData({ loadingMore: true });
    else {
      this.boardsFirstPageLoading = true;
      this.setData({ loading: true, loadingMore: false, errorText: '' });
    }

    try {
      const data = (await fetchBoards({
        q: query,
        cursor: append ? this.data.nextCursor : '',
        status: 'active',
      })) || {};
      if (requestId !== this.boardRequestId) return;
      if (!append) this.boardsFirstPageLoading = false;
      const items = (data.items || []).filter((board) => board && board.status === 'active');
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
      if (requestId !== this.boardRequestId) return;
      if (!append) this.boardsFirstPageLoading = false;
      if (append) {
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '板块加载失败，请重试',
      });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  onSearch() {
    const query = String(this.data.keyword || '').trim();
    this.boardRequestId = (this.boardRequestId || 0) + 1;
    this.setData({ query, list: [], nextCursor: null, hasMore: false, stale: false }, () => this.loadBoards());
  },

  onSearchConfirm() {
    this.onSearch();
  },

  onSearchClear() {
    this.boardRequestId = (this.boardRequestId || 0) + 1;
    this.setData({ keyword: '', query: '', list: [], nextCursor: null, hasMore: false, stale: false }, () => this.loadBoards());
  },

  onBoardTap(e) {
    const { id } = e.currentTarget.dataset;
    if (id) navigateTo(`/pages/community/board/index?id=${encodeURIComponent(id)}`);
  },

  onCreateTap() {
    if (!this.data.isMember) {
      this.askJoin();
      return;
    }
    this.setData({
      createVisible: true,
      title: '',
      titleCount: 0,
      description: '',
      descriptionCount: 0,
      canSubmit: false,
    });
  },

  onTitleInput(e) {
    const title = e.detail.value || '';
    this.setData({ title, titleCount: title.length, canSubmit: !!title.trim() });
  },

  onDescriptionInput(e) {
    const description = e.detail.value || '';
    this.setData({ description, descriptionCount: description.length });
  },

  onCreateClose() {
    if (this.data.submitting) return;
    this.setData({ createVisible: false });
  },

  onStopPropagation() {},

  async onCreateSubmit() {
    if (this.data.submitting || !this.data.canSubmit) return;
    const title = String(this.data.title || '').trim();
    const description = String(this.data.description || '').trim();
    if (!title) return;

    this.setData({ submitting: true });
    try {
      const result = (await submitBoard({ title, description })) || {};
      const status = result.status || 'pending';
      const id = result.id || result.boardId || '';
      this.setData({
        submitting: false,
        createVisible: false,
        title: '',
        titleCount: 0,
        description: '',
        descriptionCount: 0,
        canSubmit: false,
        createdBoardId: id,
        createdStatus: status,
        createdDuplicate: !!result.duplicated,
      });
      if (result.duplicated && status === 'active') {
        wx.showToast({ title: '已找到同名板块', icon: 'none' });
      } else if (result.duplicated) {
        wx.showToast({ title: '这个板块已在审核中', icon: 'none' });
      } else if (status === 'active') {
        wx.showToast({ title: '板块已创建', icon: 'success' });
        this.loadBoards();
      } else {
        wx.showToast({ title: '已收到，等待审核', icon: 'none' });
      }
    } catch (err) {
      this.setData({ submitting: false });
      wx.showModal({
        title: '板块未提交',
        content: err.kind === 'conflict'
          ? '相近名称的板块可能已经存在或正在审核，请调整名称后重试。'
          : (err.message || '提交失败，请稍后重试。'),
        showCancel: false,
      });
    }
  },

  onViewCreatedBoard() {
    if (this.data.createdBoardId) {
      navigateTo(`/pages/community/board/index?id=${encodeURIComponent(this.data.createdBoardId)}`);
    }
  },

  onCreatedFeedbackClose() {
    this.setData({ createdBoardId: '', createdStatus: '', createdDuplicate: false });
  },

  onRetry() {
    this.loadBoards();
  },

  onAdminQueueTap() {
    if (this.data.isAdmin) navigateTo('/pages/admin/reviews/index');
  },

  onJoinTap() {
    this.askJoin();
  },

  askJoin() {
    wx.showModal({
      title: '需要成员资格',
      content: '加入文学社后，可以浏览社内板块或提交板块建议。',
      confirmText: '去了解',
      success: (res) => {
        if (res.confirm) navigateTo('/pages/community/join/index?from=boards');
      },
    });
  },
});
