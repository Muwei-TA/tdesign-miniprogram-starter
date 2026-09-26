import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

Page({
  data: {
    categories: TOPIC_CATEGORIES,
    category: 'all',
    list: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loading: true,
    stale: false,
    errorText: '',
    isMember: false,

    // 发起话题弹层
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
    const session = getSession();
    this.setData({ isMember: session.memberStatus === 'active' });
    this.loadTopics();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'topics' });
    }
  },

  onPullDownRefresh() {
    this.loadTopics().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadTopics({ append: true });
  },

  async loadTopics({ append = false } = {}) {
    if (append && (this.data.loading || this.topicsFirstPageLoading || this.data.loadingMore || !this.data.hasMore)) return;
    const requestId = (this.listRequestId || 0) + 1;
    this.listRequestId = requestId;
    const { category } = this.data;
    if (append) this.setData({ loadingMore: true });
    else {
      this.topicsFirstPageLoading = true;
      this.setData({ loading: true, loadingMore: false, stale: false, errorText: '' });
    }
    try {
      const data = await fetchTopics({ category, cursor: append ? this.data.nextCursor : '' });
      // 快速切换分类时，旧响应不得覆盖当前分类
      if (requestId !== this.listRequestId) return;
      if (!append) this.topicsFirstPageLoading = false;
      this.setData({
        list: append ? this.data.list.concat(data.items || []) : data.items || [],
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.listRequestId) return;
      if (!append) this.topicsFirstPageLoading = false;
      if (append) {
        // 追加失败不破坏已有列表
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
    this.setData(
      { category: value, list: [], nextCursor: null, hasMore: false, stale: false, errorText: '' },
      () => this.loadTopics(),
    );
  },

  onTopicTap(e) {
    navigateTo(`/pages/community/topic/index?id=${e.detail.id}`);
  },

  async onFollow(e) {
    const { id, next } = e.detail;
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.setData({ [`list[${index}].followed`]: next });
    try {
      await toggleFollow(id, next);
    } catch (err) {
      this.setData({ [`list[${index}].followed`]: !next });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  },

  onCreateOpen() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '需要成员资格',
        content: '发起话题需要先加入文学社。',
        confirmText: '去了解',
        success: (res) => {
          if (res.confirm) navigateTo('/pages/community/join/index?from=topics');
        },
      });
      return;
    }
    this.setData({ createVisible: true, keyboardHeight: 0, activeFieldId: '' });
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

  async onCreateSubmit() {
    if (this.submittingRequest || this.data.submitting) return;
    const { title, description, category } = this.data.form;
    if (!title.trim()) {
      wx.showToast({ title: '请填写话题名称', icon: 'none' });
      return;
    }
    this.hideEditorKeyboard();
    // 同名话题由服务端引导参与，不创建重复项
    const duplicated = this.data.list.find((item) => item.title === title.trim());
    if (duplicated) {
      wx.showModal({
        title: '已有相同话题',
        content: '这个话题已经存在，去参与就好。',
        confirmText: '去参与',
        success: (res) => {
          if (res.confirm) {
            this.setData({ createVisible: false });
            navigateTo(`/pages/community/topic/index?id=${duplicated.id}`);
          }
        },
      });
      return;
    }

    this.submittingRequest = true;
    this.setData({ submitting: true, canSubmit: false, keyboardHeight: 0, activeFieldId: '' });
    try {
      await submitTopic({ title: title.trim(), description: description.trim(), category });
      this.setData({
        submitting: false,
        canSubmit: false,
        createVisible: false,
        keyboardHeight: 0,
        activeFieldId: '',
        form: { title: '', description: '', category: 'life' },
      });
      wx.showToast({ title: '已提交，等待管理员确认', icon: 'none' });
      this.loadTopics();
    } catch (err) {
      this.setData({ submitting: false, canSubmit: !!title.trim() });
      wx.showToast({ title: err.message || '提交未完成', icon: 'none' });
    } finally {
      this.submittingRequest = false;
    }
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=topics');
  },

  /** 空态按钮：成员发起话题，访客先了解社团 */
  onEmptyAction() {
    if (this.data.isMember) this.onCreateOpen();
    else this.onJoin();
  },

  onRetry() {
    this.loadTopics();
  },
});
