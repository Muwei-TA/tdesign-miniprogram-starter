import { deletePost, fetchMyContents, fetchPostDetail, toggleBookmark } from '~/services/posts';
import { listDrafts, removeDraft } from '../drafts';
import { formatRelativeTime } from '../format';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const TABS = [
  { value: 'published', label: '已发布' },
  { value: 'pending', label: '待审核 / 需要修改' },
  { value: 'draft', label: '草稿' },
  { value: 'private', label: '私密手记' },
  { value: 'bookmark', label: '收藏' },
  { value: 'topics', label: '关注的话题' },
];

const VALID_TABS = new Set(TABS.map((item) => item.value));

Page({
  data: {
    tabs: TABS,
    tab: 'published',
    session: null,
    sessionReady: false,
    isGuest: false,
    loading: true,
    stale: false,
    errorText: '',
    list: [],
    unavailable: [],
    drafts: [],
    topics: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
  },

  onLoad(options) {
    const tab = VALID_TABS.has(options.tab) ? options.tab : 'published';
    this.setData({ tab });
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (this.data.sessionReady && !this.data.isGuest) this.loadTab({ silent: true });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.tab === 'draft') return;
    this.loadTab({ append: true });
  },

  applySession(session) {
    if (!session) return;
    const isGuest = !session.user;
    // 账号切换或退出时，丢弃仍在途的列表请求，避免旧账号内容回写。
    this.tabRequestId = (this.tabRequestId || 0) + 1;
    this.setData({ session, sessionReady: true, isGuest }, () => {
      if (isGuest) {
        this.setData({ loading: false, list: [], unavailable: [], drafts: [], topics: [], nextCursor: null, hasMore: false });
        return;
      }
      this.loadTab();
    });
  },

  async loadTab({ silent = false, append = false } = {}) {
    if (!this.data.sessionReady || this.data.isGuest) return;
    if (append && (this.data.loadingMore || !this.data.hasMore || this.data.tab === 'draft')) return;
    const requestedTab = this.data.tab;
    const requestId = (this.tabRequestId || 0) + 1;
    this.tabRequestId = requestId;
    if (append) this.setData({ loadingMore: true });
    else if (!silent) this.setData({ loading: true, errorText: '' });

    if (requestedTab === 'draft') {
      this.setData({
        loading: false,
        stale: false,
        errorText: '',
        drafts: listDrafts().map((draft) => ({
          ...draft,
          updatedAtText: formatRelativeTime(draft.updatedAt),
          kindText: draft.kind === 'article' ? '文章' : '碎片',
        })),
        list: [],
        unavailable: [],
        topics: [],
        nextCursor: null,
        hasMore: false,
      });
      return;
    }

    try {
      const result = await fetchMyContents({ tab: requestedTab, cursor: append ? this.data.nextCursor : '' });
      if (requestId !== this.tabRequestId || requestedTab !== this.data.tab) return;
      const items = result.items || [];
      const patch = {
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
        nextCursor: result.nextCursor || null,
        hasMore: !!result.nextCursor,
      };
      if (append) {
        // 追加只拼接当前 tab 对应的集合，另一侧保持不动
        if (requestedTab === 'topics') patch.topics = this.data.topics.concat(items);
        else {
          if (requestedTab === 'bookmark') {
            patch.unavailable = this.data.unavailable.concat(items.filter((item) => item.unavailable));
          }
          patch.list = this.data.list.concat(items.filter((item) => !item.unavailable));
        }
      } else {
        patch.list = requestedTab === 'topics' ? [] : items.filter((item) => !item.unavailable);
        patch.unavailable = requestedTab === 'bookmark' ? items.filter((item) => item.unavailable) : [];
        patch.topics = requestedTab === 'topics' ? items : [];
        patch.drafts = [];
      }
      this.setData(patch);
    } catch (err) {
      if (requestId !== this.tabRequestId || requestedTab !== this.data.tab) return;
      if (append) {
        // 追加失败不破坏已有列表
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        stale: this.data.list.length > 0 || this.data.unavailable.length > 0 || this.data.topics.length > 0,
        errorText: err.message || '列表暂时没有更新',
      });
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.value;
    if (!VALID_TABS.has(tab) || tab === this.data.tab) return;
    this.setData({ tab, list: [], unavailable: [], drafts: [], topics: [], nextCursor: null, hasMore: false }, () =>
      this.loadTab(),
    );
  },

  onRetry() {
    this.loadTab();
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=my-content');
  },

  onPostTap(e) {
    const id = (e.detail && e.detail.id) || e.currentTarget.dataset.id;
    if (!id) return;
    navigateTo(`/pages/community/post/index?id=${id}&from=mine`);
  },

  onDraftTap(e) {
    navigateTo(`/pages/release/index?draftId=${e.currentTarget.dataset.id}`);
  },

  onNewDraft() {
    navigateTo('/pages/release/index');
  },

  onDeleteDraft(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除草稿',
      content: '删除后无法恢复，这不会影响已经提交的内容。',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return;
        removeDraft(id);
        this.loadTab();
      },
    });
  },

  async onRemoveBookmark(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.bookmarkRemoving) return;
    this.bookmarkRemoving = true;
    try {
      await toggleBookmark(id, false);
      this.setData({ unavailable: this.data.unavailable.filter((item) => item.id !== id) });
    } catch (err) {
      wx.showToast({ title: err.message || '移除未完成', icon: 'none' });
    } finally {
      this.bookmarkRemoving = false;
    }
  },

  async onDeleteContent(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.contentDeleting) return;
    this.contentDeleting = true;
    try {
      // 列表 DTO 没有 version；先按 id 重新鉴权读取详情，再确认删除。
      const detail = await fetchPostDetail(id);
      wx.showModal({
        title: '删除这条内容',
        content: '删除后无法恢复，相关回应也会一并停止展示。',
        confirmText: '删除',
        success: async (res) => {
          if (!res.confirm) {
            this.contentDeleting = false;
            return;
          }
          try {
            await deletePost(id, detail.version);
            this.setData({ list: this.data.list.filter((item) => item.id !== id) });
            wx.showToast({ title: '已删除', icon: 'none' });
          } catch (err) {
            wx.showToast({ title: err.message || '删除未完成', icon: 'none' });
          } finally {
            this.contentDeleting = false;
          }
        },
      });
    } catch (err) {
      wx.showToast({ title: err.message || '内容当前不可访问', icon: 'none' });
      this.contentDeleting = false;
    }
  },

  async onAppealContent(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.appealOpening) return;
    this.appealOpening = true;
    try {
      // 本人列表 DTO 已带当前版本。hidden/rejected 正文可能无法按普通详情权限读取，
      // 所以申诉入口不能先读取详情再决定是否跳转。
      const item = this.data.list.find((entry) => entry.id === id);
      if (!item || (item.status !== 'rejected' && item.status !== 'hidden')) {
        wx.showToast({ title: '这条内容当前不能申诉', icon: 'none' });
        return;
      }
      if (!Number.isInteger(item.version) || item.version < 1) {
        wx.showToast({ title: '内容版本暂时无法确认', icon: 'none' });
        return;
      }
      navigateTo(`/pages/community/appeals/index?postId=${encodeURIComponent(id)}&version=${item.version}`);
    } catch (err) {
      wx.showToast({ title: err.message || '申诉入口暂时无法打开', icon: 'none' });
    } finally {
      this.appealOpening = false;
    }
  },

  onEditRejected(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((entry) => entry.id === id);
    if (!item || item.status !== 'rejected') return;
    navigateTo(`/pages/community/resubmit/index?id=${encodeURIComponent(id)}`);
  },

  onTopicTap(e) {
    const id = (e.detail && e.detail.id) || e.currentTarget.dataset.id;
    if (id) navigateTo(`/pages/community/topic/index?id=${id}`);
  },
});
