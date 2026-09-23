import { search, fetchSuggestions } from './search';
import { navigateTo } from '~/utils/navigate';

/**
 * P11 站内搜索（基线版本，完整验收项见 docs/08 P11 与任务 T-10）。
 * 前端职责：防抖、丢弃过期响应、失败重试不清空输入。
 * 权限过滤由服务端完成：私密内容与匿名帖的真实作者名都不参与检索。
 */
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
    searched: false,
    loading: false,
    stale: false,
    errorText: '',
  },

  onLoad(options) {
    this.loadSuggestions();
    if (options.keyword) {
      this.setData({ keyword: options.keyword }, () => this.runSearch());
    }
  },

  onUnload() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  },

  async loadSuggestions() {
    try {
      const data = await fetchSuggestions();
      this.setData({ suggestions: data.items || [] });
    } catch (err) {
      // 推荐词失败不影响搜索
    }
  },

  onInput(e) {
    const keyword = e.detail.value;
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    this.setData({ keyword });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!keyword.trim()) {
      // 清空恢复推荐词
      this.setData({ results: [], searched: false, loading: false, stale: false, errorText: '' });
      return;
    }
    this.setData({ loading: false, stale: false, errorText: '' });
    this.debounceTimer = setTimeout(() => this.runSearch(), 300);
  },

  onSubmit() {
    this.runSearch();
  },

  onScopeTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.scope) return;
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    this.setData({ scope: value, results: [], loading: false, stale: false, errorText: '' }, () => {
      if (this.data.keyword.trim()) this.runSearch();
    });
  },

  onSuggestionTap(e) {
    const { word } = e.currentTarget.dataset;
    this.setData({ keyword: word }, () => this.runSearch());
  },

  async runSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    const requestId = (this.searchRequestId || 0) + 1;
    this.searchRequestId = requestId;
    const { scope } = this.data;
    this.setData({ loading: true, stale: false, errorText: '' });
    try {
      const data = await search({ q: keyword, scope });
      if (requestId !== this.searchRequestId) return;
      // 慢响应不覆盖新查询
      if (data.stale) {
        this.setData({
          loading: false,
          searched: true,
          stale: this.data.results.length > 0,
          errorText: '这次搜索结果已过期，请重试',
        });
        return;
      }
      this.setData({ results: data.items || [], searched: true, loading: false, stale: false, errorText: '' });
    } catch (err) {
      if (requestId !== this.searchRequestId) return;
      // 失败重试不清空输入
      this.setData({
        loading: false,
        searched: true,
        stale: this.data.results.length > 0,
        errorText: err.message || '查询失败',
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
