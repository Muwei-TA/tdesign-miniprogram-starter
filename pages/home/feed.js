/** 首页信息流与推荐板块流程。页面上下文通过参数传入，便于独立维护状态和请求规则。 */
export function createHomeFeed({ fetchFeed, fetchBoards, FEED_FILTERS, getSession, app, wx }) {
  async function loadRecommendations(session = getSession()) {
    const requestId = (this.recommendationRequestId || 0) + 1;
    this.recommendationRequestId = requestId;

    if (!session || session.memberStatus !== 'active') {
      const patch = {
        recommendationState: 'guest',
        filters: FEED_FILTERS,
      };
      if (this.data.selectedBoardId) this.resetFeedForBoard('', patch);
      else this.setData(patch);
      return;
    }

    this.setData({ recommendationState: 'loading' });

    try {
      const data = (await fetchBoards({ status: 'active' })) || {};
      if (requestId !== this.recommendationRequestId) return;
      const boards = (data.items || [])
        .filter((board) => board && board.status === 'active' && board.id)
        .slice(0, 9);
      const filters = FEED_FILTERS.concat(boards.map((board) => ({
        value: board.id,
        label: board.title,
      })));
      const selectedBoardId = boards.some((board) => board.id === this.data.selectedBoardId)
        ? this.data.selectedBoardId
        : '';
      const patch = {
        recommendationState: boards.length > 0 ? 'ready' : 'empty',
        filters,
      };
      if (selectedBoardId !== this.data.selectedBoardId) this.resetFeedForBoard(selectedBoardId, patch);
      else this.setData(patch);
    } catch (_) {
      if (requestId !== this.recommendationRequestId) return;
      this.setData({ recommendationState: 'error' });
    }
  }

  async function loadFeed({ silent = false, append = false } = {}) {
    if (append && (this.data.loading || this.feedFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    const { selectedBoardId } = this.data;
    if (append) {
      this.setData({ loadingMore: true });
    } else {
      this.feedFirstPageLoading = true;
      this.setData(silent ? { loadingMore: false } : { loading: true, loadingMore: false, errorText: '' });
    }
    try {
      const data = await fetchFeed({ boardId: selectedBoardId, cursor: append ? this.data.nextCursor : '' });
      // 快速切换筛选时，旧响应不得覆盖新筛选
      if (requestId !== this.feedRequestId) return;
      if (!append) this.feedFirstPageLoading = false;
      this.setData({
        list: append ? this.data.list.concat(data.items || []) : data.items || [],
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
      if (!append) this.feedFirstPageLoading = false;
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
  }

  function onFilterTap(e) {
    const { value } = e.currentTarget.dataset;
    this.setBoardSelection(value === 'all' ? '' : value);
  }

  function setBoardSelection(boardId) {
    if (boardId === this.data.selectedBoardId) return;
    this.resetFeedForBoard(boardId);
  }

  function resetFeedForBoard(boardId, patch = {}) {
    // 立即作废旧请求，防止旧筛选的首屏或追加结果覆盖当前选择。
    this.feedRequestId = (this.feedRequestId || 0) + 1;
    this.feedFirstPageLoading = false;
    this.setData({
      ...patch,
      selectedBoardId: boardId,
      list: [],
      nextCursor: null,
      hasMore: false,
      loadingMore: false,
      stale: false,
      errorText: '',
    }, () => this.loadFeed());
  }

  function onRetry() {
    this.loadFeed();
  }

  return {
    loadRecommendations,
    loadFeed,
    onFilterTap,
    setBoardSelection,
    resetFeedForBoard,
    onRetry,
  };
}
