import { search, fetchSuggestions } from './search';
import { navigateTo } from '~/utils/navigate';

/** 搜索会话绑定关键词和范围；新首页完成前禁止使用旧游标追加。 */
const SCOPES = [
  { value: 'post', label: '内容' },
  { value: 'topic', label: '话题' },
];

Page({
  data: {
    scopes: SCOPES,
    scope: 'post',
    keyword: '',
    suggestions: [],
    results: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    searched: false,
    loading: false,
    stale: false,
    errorText: '',
  },

  onLoad(options) {
    this.loadSuggestions();
    if (options.keyword) this.setData({ keyword: options.keyword }, () => this.runSearch());
  },

  clearSearchTimer() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  },

  onUnload() {
    this.clearSearchTimer();
    this.searchRequestId = (this.searchRequestId || 0) + 1;
  },

  onReachBottom() {
    if (this.data.loading || this.debounceTimer || !this.data.hasMore || this.data.loadingMore) return;
    return this.runSearch({ append: true });
  },

  async loadSuggestions() {
    try {
      const data = await fetchSuggestions();
      this.setData({ suggestions: data.items || [] });
    } catch (err) {
      // 推荐词失败不影响搜索。
    }
  },

  resetQuery(patch = {}) {
    this.clearSearchTimer();
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    this.searchQueryKey = null;
    this.setData({
      ...patch, results: [], nextCursor: null, hasMore: false, loadingMore: false,
      searched: false, loading: false, stale: false, errorText: '',
    });
  },

  onInput(e) {
    const keyword = e.detail.value;
    this.resetQuery({ keyword });
    if (!keyword.trim()) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runSearch();
    }, 300);
  },

  onSubmit() {
    this.clearSearchTimer();
    return this.runSearch();
  },

  onScopeTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.scope) return;
    this.resetQuery({ scope: value });
    if (this.data.keyword.trim()) return this.runSearch();
  },

  onSuggestionTap(e) {
    this.resetQuery({ keyword: e.currentTarget.dataset.word });
    return this.runSearch();
  },

  async runSearch({ append = false } = {}) {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    const { scope } = this.data;
    const queryKey = JSON.stringify([scope, keyword]);
    if (append && (this.data.loading || this.debounceTimer || this.data.loadingMore
      || !this.data.hasMore || this.searchQueryKey !== queryKey)) return;
    const cursor = append ? this.data.nextCursor : '';
    const requestId = (this.searchRequestId || 0) + 1;
    this.searchRequestId = requestId;
    if (append) {
      this.setData({ loadingMore: true });
    } else {
      this.clearSearchTimer();
      this.searchQueryKey = queryKey;
      this.setData({ loading: true, loadingMore: false, nextCursor: null, hasMore: false, stale: false, errorText: '' });
    }
    try {
      const data = await search({ q: keyword, scope, cursor });
      if (requestId !== this.searchRequestId || this.searchQueryKey !== queryKey) return;
      if (data.stale) throw new Error('这次搜索结果已过期，请重试');
      this.setData({
        results: append ? this.data.results.concat(data.items || []) : data.items || [],
        nextCursor: data.nextCursor || null,
        hasMore: !!data.nextCursor,
        searched: true,
        loading: false,
        loadingMore: false,
        stale: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.searchRequestId) return;
      if (append) {
        this.setData({ loadingMore: false });
        wx.showToast({ title: '加载更多失败', icon: 'none' });
        return;
      }
      this.setData({
        loading: false, loadingMore: false, searched: true,
        stale: this.data.results.length > 0, errorText: err.message || '查询失败',
      });
    }
  },

  onResultTap(e) {
    const { id } = e.detail;
    if (this.data.scope === 'topic') {
      navigateTo(`/pages/community/topic/index?id=${id}`);
      return;
    }
    navigateTo(`/pages/community/post/index?id=${id}&from=search`);
  },

  onRetry() {
    return this.runSearch();
  },
});
