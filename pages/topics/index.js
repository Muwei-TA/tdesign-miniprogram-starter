import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();
const SEARCH_DEBOUNCE_MS = 300;

Page({
  data: {
    categories: TOPIC_CATEGORIES,
    category: 'all',
    searchQuery: '',
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loading: true,
    stale: false,
    errorText: '',
    pendingCount: 0,
    isMember: false,
    canReviewTopics: false,

    // 创建板块弹层
    createVisible: false,
    form: { title: '', description: '', category: 'life' },
    canSubmit: false,
    submitting: false,
    keyboardHeight: 0,
    editorTopInset: 0,
    editorWindowHeight: 0,
    editorBottomInset: 0,
    activeFieldId: '',
  },

  onLoad() {
    this.listRequestId = 0;
    this.topicsQueryKey = null;
    this.topicsFirstPageLoading = false;
    this.searchDebounceTimer = null;
    this.sessionReady = false;
    this.needsTopicsRefreshOnShow = false;

    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const safeAreaTop = windowInfo.safeArea ? windowInfo.safeArea.top : windowInfo.statusBarHeight || 0;
    const menuButton = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
    const editorTopInset = menuButton && menuButton.bottom
      ? menuButton.bottom + 8
      : safeAreaTop + (windowInfo.statusBarHeight || 0) + 8;
    const editorWindowHeight = windowInfo.windowHeight || 0;
    const safeAreaBottom = windowInfo.safeArea ? windowInfo.safeArea.bottom : editorWindowHeight;
    const editorBottomInset = Math.max(editorWindowHeight - safeAreaBottom, 0);
    this.setData({ editorTopInset, editorWindowHeight, editorBottomInset });
    this.syncSession(getSession());
    this.onSessionChanged = (session) => this.syncSession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    this.loadTopics();
  },

  onShow() {
    // 会话状态同步使用本地缓存；返回页面时重载当前目录，看到新通过审核的板块。
    const requestIdBeforeSessionSync = this.listRequestId || 0;
    this.syncSession(getSession());
    const sessionSyncReloaded = (this.listRequestId || 0) !== requestIdBeforeSessionSync;
    if (this.needsTopicsRefreshOnShow) {
      this.needsTopicsRefreshOnShow = false;
      if (!sessionSyncReloaded) this.loadTopics();
    }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'topics' });
    }
  },

  onHide() {
    this.needsTopicsRefreshOnShow = true;
    this.clearSearchTimer();
  },

  onUnload() {
    this.clearSearchTimer();
    this.listRequestId = (this.listRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  clearSearchTimer() {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = null;
  },

  syncSession(session) {
    if (!session) return;
    const isMember = session.memberStatus === 'active';
    const canReviewTopics = isMember && ['admin', 'moderator'].includes(session.role);
    const shouldReload = this.sessionReady
      && (isMember !== this.data.isMember || canReviewTopics !== this.data.canReviewTopics);
    this.sessionReady = true;
    this.setData({ isMember, canReviewTopics });
    if (shouldReload) {
      this.clearSearchTimer();
      this.loadTopics();
    }
  },

  onPullDownRefresh() {
    this.clearSearchTimer();
    return this.loadTopics().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    return this.loadTopics({ append: true });
  },

  currentQueryKey() {
    return JSON.stringify([this.data.category, this.data.searchQuery.trim()]);
  },

  async loadTopics({ append = false } = {}) {
    const queryKey = this.currentQueryKey();
    if (append && (this.data.loading || this.topicsFirstPageLoading || this.data.loadingMore
      || !this.data.hasMore || this.topicsQueryKey !== queryKey)) return;

    const requestId = (this.listRequestId || 0) + 1;
    this.listRequestId = requestId;
    const { category, searchQuery } = this.data;
    const q = searchQuery.trim();
    if (append) this.setData({ loadingMore: true });
    else {
      this.topicsQueryKey = queryKey;
      this.topicsFirstPageLoading = true;
      this.setData({ loading: true, loadingMore: false, stale: false, errorText: '' });
    }
    try {
      const data = await fetchTopics({ category, q, cursor: append ? this.data.nextCursor : '' });
      // 搜索词、分类或权限变化时，旧响应不得覆盖新目录。
      if (requestId !== this.listRequestId || queryKey !== this.currentQueryKey()) return;
      if (!append) this.topicsFirstPageLoading = false;
      const list = append ? this.data.list.concat(data.items || []) : data.items || [];
      this.setData({
        list,
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
        pendingCount: list.filter((item) => item.status === 'pending').length,
      });
    } catch (err) {
      if (requestId !== this.listRequestId || queryKey !== this.currentQueryKey()) return;
      if (!append) this.topicsFirstPageLoading = false;
      if (append) {
        // 追加失败不破坏已显示的目录。
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

  onCategoryTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.category) return;
    this.clearSearchTimer();
    this.listRequestId = (this.listRequestId || 0) + 1;
    this.topicsFirstPageLoading = false;
    this.topicsQueryKey = null;
    this.setData(
      { category: value, list: [], nextCursor: null, hasMore: false, pendingCount: 0, loading: true, stale: false, errorText: '' },
      () => this.loadTopics(),
    );
  },

  onSearchInput(e) {
    const searchQuery = String((e.detail && e.detail.value) || '');
    if (searchQuery === this.data.searchQuery) return;
    this.clearSearchTimer();
    // 输入时就使旧请求失效，防止防抖窗口内旧关键词结果闪回。
    this.listRequestId = (this.listRequestId || 0) + 1;
    this.topicsFirstPageLoading = false;
    this.topicsQueryKey = null;
    this.setData({
      searchQuery,
      list: [],
      nextCursor: null,
      hasMore: false,
      pendingCount: 0,
      loading: !!searchQuery.trim(),
      loadingMore: false,
      stale: false,
      errorText: '',
    });
    if (!searchQuery.trim()) {
      this.loadTopics();
      return;
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null;
      this.loadTopics();
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchSubmit() {
    this.clearSearchTimer();
    return this.loadTopics();
  },

  onSearchClear() {
    this.onSearchInput({ detail: { value: '' } });
  },

  onLoadMoreTap() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    return this.loadTopics({ append: true });
  },

  onTopicTap(e) {
    navigateTo(`/pages/community/topic/index?id=${e.detail.id}`);
  },

  async onFollow(e) {
    const { id, next } = e.detail;
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const list = this.data.list.map((item, itemIndex) => (
      itemIndex === index ? { ...item, followed: next } : item
    ));
    this.setData({ list });
    try {
      await toggleFollow(id, next);
    } catch (err) {
      const revertedList = this.data.list.map((item) => (
        item.id === id ? { ...item, followed: !next } : item
      ));
      this.setData({ list: revertedList });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  },

  onCreateOpen() {
    // 点击时重新读服务层缓存，避免冷启动期间页面保留的 guest 占位状态挡住成员。
    const session = getSession();
    this.syncSession(session);
    if (!session || session.memberStatus !== 'active') {
      wx.showModal({
        title: '需要成员资格',
        content: '创建板块需要先加入文学社。',
        confirmText: '去了解',
        success: (res) => {
          if (res.confirm) navigateTo('/pages/community/join/index?from=topics');
        },
      });
      return;
    }
    this.setData({ createVisible: true, keyboardHeight: 0, activeFieldId: '' });
  },

  onReviewQueueTap() {
    navigateTo('/pages/admin/index?queue=topic');
  },

  hideEditorKeyboard() {
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  onCreateClose(e) {
    const { detail } = e || {};
    if (detail && detail.visible === true) return;
    if (this.submittingRequest || this.data.submitting) return;
    this.hideEditorKeyboard();
    // 关闭只收起编辑器，保留用户输入供再次打开时继续编辑。
    this.setData({ createVisible: false, keyboardHeight: 0, activeFieldId: '' });
  },

  onFormFocus(e) {
    const { currentTarget: { dataset: { field } } } = e;
    const activeFieldId = field === 'title' ? 'topic-title-field' : 'topic-description-field';
    this.setData({ activeFieldId });
  },

  onEditorKeyboardHeightChange(e) {
    const { detail } = e || {};
    const { height } = detail || {};
    const keyboardHeight = Number(height) > 0 ? Number(height) : 0;
    this.setData({ keyboardHeight });
  },

  onFormInput(e) {
    if (this.data.submitting) return;
    const { currentTarget: { dataset: { field } }, detail: { value } } = e;
    const patch = { [`form.${field}`]: value };
    if (field === 'title') patch.canSubmit = !!value.trim();
    this.setData(patch);
  },

  onFormCategory(e) {
    if (this.data.submitting) return;
    this.setData({ 'form.category': e.currentTarget.dataset.value });
  },

  showExistingTopic(topic) {
    const status = topic.status || 'active';
    const isPending = status === 'pending';
    const isArchived = status === 'archived';
    let content = '这个板块已经存在，可以直接查看并参与。';
    let confirmText = '去参与';
    let title = '已有同名板块';
    if (isPending) {
      title = '板块仍在审核';
      content = '这个板块仍在等待管理员审核。';
      confirmText = '查看进度';
    } else if (isArchived) {
      content = '这个板块已归档，可以查看，但不能新增内容。';
      confirmText = '查看板块';
    }
    wx.showModal({
      title,
      content,
      confirmText,
      success: (res) => {
        if (res.confirm) {
          this.setData({ createVisible: false, keyboardHeight: 0, activeFieldId: '' });
          navigateTo(`/pages/community/topic/index?id=${topic.id}`);
        }
      },
    });
  },

  async onCreateSubmit() {
    if (this.submittingRequest || this.data.submitting) return;
    const { title, description, category } = this.data.form;
    if (!title.trim()) {
      wx.showToast({ title: '请填写板块名称', icon: 'none' });
      return;
    }
    this.hideEditorKeyboard();
    // 已加载的重复项可直接引导；未加载的同名项由服务端依据完整数据判断。
    const duplicated = this.data.list.find((item) => item.title === title.trim());
    if (duplicated) {
      this.showExistingTopic(duplicated);
      return;
    }

    this.submittingRequest = true;
    this.setData({ submitting: true, canSubmit: false, keyboardHeight: 0, activeFieldId: '' });
    try {
      const result = await submitTopic({ title: title.trim(), description: description.trim(), category });
      if (result && result.duplicated) {
        this.setData({ submitting: false, canSubmit: !!title.trim() });
        if (result.id) {
          this.showExistingTopic(result);
        } else {
          wx.showModal({
            title: '已有同名板块待审核',
            content: '已有社员提交了同名板块，正在等待管理员审核。请修改名称，或稍后查看目录。',
            showCancel: false,
          });
        }
        return;
      }

      this.clearSearchTimer();
      this.listRequestId = (this.listRequestId || 0) + 1;
      this.topicsFirstPageLoading = false;
      this.topicsQueryKey = null;
      this.setData({
        submitting: false,
        canSubmit: false,
        createVisible: false,
        keyboardHeight: 0,
        activeFieldId: '',
        form: { title: '', description: '', category: 'life' },
        category: 'all',
        searchQuery: '',
        list: [],
        nextCursor: null,
        hasMore: false,
        pendingCount: 0,
      }, () => {
        wx.showToast({ title: '已提交，等待管理员审核', icon: 'none' });
        this.loadTopics();
      });
    } catch (err) {
      this.setData({ submitting: false, canSubmit: !!title.trim() });
      if (err.kind === 'conflict') {
        wx.showModal({
          title: '板块未提交',
          content: err.message || '已有社员提交了同名板块，正在等待管理员审核。请修改名称后重试。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: err.message || '提交未完成', icon: 'none' });
      }
    } finally {
      this.submittingRequest = false;
    }
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=topics');
  },

  /** 空态按钮：成员创建板块，访客先了解社团。 */
  onEmptyAction() {
    if (this.data.isMember) this.onCreateOpen();
    else this.onJoin();
  },

  onSearchEmptyAction() {
    if (this.data.hasMore) this.onLoadMoreTap();
    else this.onSearchClear();
  },

  onRetry() {
    this.clearSearchTimer();
    return this.loadTopics();
  },
});
