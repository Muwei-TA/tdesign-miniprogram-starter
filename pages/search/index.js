import { search, fetchSuggestions } from './search';
import { navigateTo } from '~/utils/navigate';
import { createSearchController } from './controller';

/** 搜索会话绑定关键词和范围；新首页完成前禁止使用旧游标追加。 */
const SCOPES = [
  { value: 'post', label: '内容' },
  { value: 'topic', label: '话题' },
];
const searchController = createSearchController({ search, fetchSuggestions, wx, setTimeout, clearTimeout });

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
    return searchController.clearSearchTimer.call(this);
  },

  onUnload() {
    this.clearSearchTimer();
    this.searchRequestId = (this.searchRequestId || 0) + 1;
  },

  onReachBottom() {
    return searchController.onReachBottom.call(this);
  },

  async loadSuggestions() {
    return searchController.loadSuggestions.call(this);
  },

  resetQuery(patch = {}) {
    return searchController.resetQuery.call(this, patch);
  },

  onInput(e) {
    return searchController.onInput.call(this, e);
  },

  onSubmit() {
    return searchController.onSubmit.call(this);
  },

  onScopeTap(e) {
    return searchController.onScopeTap.call(this, e);
  },

  onSuggestionTap(e) {
    return searchController.onSuggestionTap.call(this, e);
  },

  async runSearch({ append = false } = {}) {
    return searchController.runSearch.call(this, { append });
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
    return searchController.onRetry.call(this);
  },
});
