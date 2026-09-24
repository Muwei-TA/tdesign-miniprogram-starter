import {
  fetchPostDetail,
  fetchComments,
  submitComment,
  COMMENT_LIMIT,
  toggleReaction,
  toggleBookmark,
  toggleCommentReaction,
  deleteComment,
  shrinkVisibility,
  deletePost,
} from '~/services/posts';
import { previewPostImage } from '~/services/image-preview';
import { createIdempotencyKey } from '~/utils/idempotency';
import { getCapabilities, getSession, scopedKey } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const FONT_SIZES = [30, 34, 38]; // rpx：对应 15 / 17 / 19 px

Page({
  data: {
    id: '',
    from: 'feed',
    post: null,
    comments: [],
    commentsLoading: false,
    commentsError: '',
    commentsStale: false,
    commentSubmitting: false,
    commentResetKey: 0,
    commentFingerprint: '',
    commentIdempotencyKey: '',
    commentIdentityMode: 'named',
    loading: true,
    // 统一不可访问态：不显示标题，避免泄露内容存在性
    notAccessible: false,
    errorText: '',

    // 长文阅读设置（账号作用域持久化）
    fontIndex: 1,
    fontSize: FONT_SIZES[1],
    nightMode: false,

    moreVisible: false,
    scopeVisible: false,
    capabilities: { publicScope: false },
  },

  onLoad(options) {
    const readingPrefs = wx.getStorageSync(scopedKey('reading-prefs')) || {};
    this.setData({
      id: options.id || '',
      from: options.from || 'feed',
      capabilities: getCapabilities(),
      fontIndex: typeof readingPrefs.fontIndex === 'number' ? readingPrefs.fontIndex : 1,
      fontSize: FONT_SIZES[typeof readingPrefs.fontIndex === 'number' ? readingPrefs.fontIndex : 1],
      nightMode: !!readingPrefs.nightMode,
    });
    this.loadDetail();
  },

  /** 详情必须按 id 重新请求，不复用列表数据 */
  async loadDetail() {
    this.setData({ loading: true, errorText: '', notAccessible: false });
    try {
      const post = await fetchPostDetail(this.data.id);
      const commentIdentityMode = post.viewer.isOwner && post.identityMode === 'anonymous' ? 'anonymous' : 'named';
      this.setData({ post, loading: false, commentIdentityMode });
      if (post.commentsEnabled || post.counters.comments > 0) this.loadComments();
    } catch (err) {
      if (err.kind === 'not_accessible' || err.kind === 'membership_invalid') {
        this.setData({ loading: false, notAccessible: true });
        return;
      }
      this.setData({ loading: false, errorText: err.message || '加载失败' });
    }
  },

  async loadComments() {
    this.setData({ commentsLoading: true, commentsError: '' });
    try {
      const data = await fetchComments(this.data.id);
      this.setData({ comments: data.items || [], commentsLoading: false, commentsStale: false });
    } catch (err) {
      // 评论加载失败不影响正文阅读，也不丢弃已经展示的回应。
      this.setData({
        commentsLoading: false,
        commentsStale: this.data.comments.length > 0,
        commentsError: err.message || '回应暂时没有更新',
      });
    }
  },

  onRetryComments() {
    this.loadComments();
  },

  onRetry() {
    this.loadDetail();
  },

  onBackHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  // ---------- 阅读设置 ----------
  onFontChange(e) {
    const { step } = e.currentTarget.dataset;
    const next = Math.min(FONT_SIZES.length - 1, Math.max(0, this.data.fontIndex + Number(step)));
    this.setData({ fontIndex: next, fontSize: FONT_SIZES[next] }, () => this.persistReadingPrefs());
  },

  onNightToggle() {
    this.setData({ nightMode: !this.data.nightMode }, () => this.persistReadingPrefs());
  },

  persistReadingPrefs() {
    wx.setStorageSync(scopedKey('reading-prefs'), {
      fontIndex: this.data.fontIndex,
      nightMode: this.data.nightMode,
    });
  },

  // ---------- 媒体 ----------
  onPreviewImage(e) {
    const { index } = e.currentTarget.dataset;
    previewPostImage(this.data.id, index);
  },

  // ---------- 互动 ----------
  async onReact() {
    this.interactionBusy = this.interactionBusy || {};
    if (this.interactionBusy.react) return;
    this.interactionBusy.react = true;
    const { post } = this.data;
    const next = !post.viewer.reacted;
    const prevCount = post.counters.reactions;
    this.setData({
      'post.viewer.reacted': next,
      'post.counters.reactions': Math.max(0, prevCount + (next ? 1 : -1)),
    });
    try {
      await toggleReaction(post.id, next);
      app.eventBus.emit('post-changed', { id: post.id, action: 'react' });
    } catch (err) {
      this.setData({ 'post.viewer.reacted': !next, 'post.counters.reactions': prevCount });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    } finally {
      this.interactionBusy.react = false;
    }
  },

  async onBookmark() {
    this.interactionBusy = this.interactionBusy || {};
    if (this.interactionBusy.bookmark) return;
    this.interactionBusy.bookmark = true;
    const { post } = this.data;
    const next = !post.viewer.bookmarked;
    this.setData({ 'post.viewer.bookmarked': next });
    try {
      await toggleBookmark(post.id, next);
      app.eventBus.emit('post-changed', { id: post.id, action: 'bookmark' });
    } catch (err) {
      this.setData({ 'post.viewer.bookmarked': !next });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    } finally {
      this.interactionBusy.bookmark = false;
    }
  },

  onCommentTap() {
    wx.pageScrollTo({ scrollTop: 99999, duration: 220 });
  },

  onCommentSubmit(e) {
    if (this.data.commentSubmitting) return;
    const body = String(e.detail.body || '').trim();
    const replyToId = e.detail.replyToId || '';
    if (!body) return;
    if (body.length > COMMENT_LIMIT) {
      wx.showToast({ title: `回应最多 ${COMMENT_LIMIT} 字`, icon: 'none' });
      return;
    }

    const fingerprint = JSON.stringify({ body, replyToId, identityMode: this.data.commentIdentityMode });
    const retrying = this.data.commentFingerprint === fingerprint && !!this.data.commentIdempotencyKey;
    const idempotencyKey = retrying ? this.data.commentIdempotencyKey : createIdempotencyKey('comment');
    this.setData({
      commentSubmitting: true,
      commentFingerprint: fingerprint,
      commentIdempotencyKey: idempotencyKey,
      commentsError: '',
    });

    if (!retrying) this.insertPendingComment({ body, replyToId });

    submitComment(this.data.id, { body, replyToId, identityMode: this.data.commentIdentityMode }, idempotencyKey)
      .then((result) => {
        if (!result || !['pending', 'published', 'rejected'].includes(result.state)) throw new Error('回应状态暂时无法确认');
        this.setData({
          commentSubmitting: false,
          commentResetKey: this.data.commentResetKey + 1,
          commentFingerprint: '',
          commentIdempotencyKey: '',
        });
        const title = { published: '回应已发布', rejected: '回应未通过安全检查', pending: '已收到，等待审核' }[result.state];
        wx.showToast({ title, icon: 'none' });
        app.eventBus.emit('post-changed', { id: this.data.id, action: 'comment' });
      })
      .catch((err) => {
        this.setData({ commentSubmitting: false, commentsError: err.message || '回应未完成，可重试' });
        wx.showToast({ title: err.message || '回应未完成，可重试', icon: 'none' });
      });
  },

  insertPendingComment({ body, replyToId }) {
    const post = this.data.post || {};
    const session = getSession();
    const anonymous = this.data.commentIdentityMode === 'anonymous';
    const authorIsPostAuthor = !!(post.viewer && post.viewer.isOwner);
    const comment = {
      id: `local-comment-${Date.now()}`,
      author: anonymous
        ? { userId: null, displayName: null, alias: '树洞身份', isAnonymous: true, isAuthor: authorIsPostAuthor }
        : {
            userId: null,
            displayName: (session.user && session.user.displayName) || '我',
            alias: null,
            isAnonymous: false,
            isAuthor: authorIsPostAuthor,
          },
      body,
      createdAtText: '刚刚',
      status: 'pending',
      version: 1,
      counters: { reactions: 0 },
      viewer: { reacted: false, canDelete: true },
      replies: [],
    };
    if (!replyToId) {
      this.setData({ comments: this.data.comments.concat(comment) });
      return;
    }
    const comments = this.data.comments.map((item) => {
      if (item.id !== replyToId) return item;
      return { ...item, replies: (item.replies || []).concat(comment) };
    });
    this.setData({ comments });
  },

  // ---------- 回应共鸣与删除 ----------
  findCommentPath(id) {
    const comments = this.data.comments || [];
    for (let i = 0; i < comments.length; i += 1) {
      const item = comments[i];
      if (item.id === id) return { path: `comments[${i}]`, item };
      const replies = item.replies || [];
      for (let j = 0; j < replies.length; j += 1) {
        if (replies[j].id === id) {
          return { path: `comments[${i}].replies[${j}]`, item: replies[j], parent: item };
        }
      }
    }
    return null;
  },

  async onCommentReact(e) {
    const { id } = e.detail;
    const located = this.findCommentPath(id);
    if (!located || located.item.deleted || located.item.status === 'pending') return;

    this.commentReactBusy = this.commentReactBusy || {};
    if (this.commentReactBusy[id]) return;
    this.commentReactBusy[id] = true;

    const next = !located.item.viewer.reacted;
    const prevCount = located.item.counters.reactions;
    this.setData({
      [`${located.path}.viewer.reacted`]: next,
      [`${located.path}.counters.reactions`]: Math.max(0, prevCount + (next ? 1 : -1)),
    });
    try {
      await toggleCommentReaction(this.data.id, id, next);
    } catch (err) {
      this.setData({
        [`${located.path}.viewer.reacted`]: !next,
        [`${located.path}.counters.reactions`]: prevCount,
      });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    } finally {
      this.commentReactBusy[id] = false;
    }
  },

  onCommentDelete(e) {
    const { id } = e.detail;
    const located = this.findCommentPath(id);
    if (!located || !located.item.viewer.canDelete) return;
    const isReply = !!located.parent;

    wx.showModal({
      title: '删除这条回应',
      content: isReply
        ? '删除后无法恢复。'
        : '删除后无法恢复；已收到的回复会保留，原位置显示已删除。',
      confirmText: '删除',
      confirmColor: '#A85648',
      success: async (res) => {
        if (!res.confirm) return;
        // 本地占位（服务端尚未返回真实 id）直接移除
        if (String(id).indexOf('local-comment-') === 0) {
          this.removeCommentLocally(id);
          return;
        }
        try {
          await deleteComment(this.data.id, id, located.item.version);
          if (located.item.status !== 'pending' && this.data.post) {
            const prev = (this.data.post.counters && this.data.post.counters.comments) || 0;
            this.setData({ 'post.counters.comments': Math.max(0, prev - 1) });
          }
          this.removeCommentLocally(id);
          app.eventBus.emit('post-changed', { id: this.data.id, action: 'comment' });
        } catch (err) {
          wx.showToast({ title: err.message || '未能删除', icon: 'none' });
        }
      },
    });
  },

  removeCommentLocally(id) {
    const comments = this.data.comments || [];
    const index = comments.findIndex((item) => item.id === id);
    if (index >= 0) {
      const next = comments.slice();
      const item = next[index];
      // 有可见回复的一级回应保留墓碑，其余直接移除
      if ((item.replies || []).length > 0) {
        next[index] = {
          ...item,
          author: { userId: null, displayName: null, isAnonymous: false, alias: null, isAuthor: false },
          body: '这条回应已被删除。',
          deleted: true,
          status: 'deleted',
          counters: { reactions: 0 },
          viewer: { reacted: false, canDelete: false },
        };
      } else {
        next.splice(index, 1);
      }
      this.setData({ comments: next });
      return;
    }

    // 定向回复：从父级移除；父级是墓碑且再无回复时一并隐藏
    const next = comments
      .map((item) => ({ ...item, replies: (item.replies || []).filter((reply) => reply.id !== id) }))
      .filter((item) => !item.deleted || (item.replies || []).length > 0);
    this.setData({ comments: next });
  },

  onTapAuthor() {
    const author = this.data.post.author || {};
    if (author.isAnonymous || !author.userId) {
      wx.showModal({
        title: '树洞身份',
        content:
          '这条内容以树洞身份发布，其他人看不到作者的昵称与头像。这不是绝对匿名——具体经历、地名与文风仍可能让人猜到。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${author.userId}`);
  },

  onTapTopic() {
    const { topic } = this.data.post;
    if (topic) navigateTo(`/pages/community/topic/index?id=${topic.id}`);
  },

  // ---------- 更多操作 ----------
  onMoreOpen() {
    this.setData({ moreVisible: true });
  },

  onMoreClose() {
    this.setData({ moreVisible: false });
  },

  onReport() {
    this.setData({ moreVisible: false });
    wx.showModal({
      title: '举报这条内容',
      content: '提交后运营者会核查。举报不等于认定违规，处理结果会通过站内消息告知，且不会向对方透露举报人。',
      confirmText: '提交举报',
      success: (res) => {
        if (res.confirm) wx.showToast({ title: '已收到，等待核查', icon: 'none' });
      },
    });
  },

  onShrinkOpen() {
    this.setData({ moreVisible: false, scopeVisible: true });
  },

  onScopeClose() {
    this.setData({ scopeVisible: false });
  },

  onScopeChange(e) {
    const { value } = e.detail;
    const labelMap = { club: '仅社内可见', private: '只有自己可见' };
    this.setData({ scopeVisible: false });
    // 缩小范围必须二次确认，并说明截图无法追回
    wx.showModal({
      title: '缩小可见范围',
      content: `改为「${labelMap[value] || value}」后，原受众将无法再看到这条内容。已经保存的截图无法追回。`,
      confirmText: '确认缩小',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await shrinkVisibility(this.data.id, value, this.data.post.version);
          this.setData({ 'post.visibility': value });
          app.eventBus.emit('post-changed', { id: this.data.id, action: 'visibility' });
          wx.showToast({ title: '已更新可见范围', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err.message || '未能更新', icon: 'none' });
        }
      },
    });
  },

  onDelete() {
    this.setData({ moreVisible: false });
    wx.showModal({
      title: '删除这条内容',
      content: '删除后无法恢复，相关回应也会一并停止展示。',
      confirmText: '删除',
      confirmColor: '#A85648',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deletePost(this.data.id, this.data.post.version);
          app.eventBus.emit('post-changed', { id: this.data.id, action: 'delete' });
          wx.navigateBack();
        } catch (err) {
          wx.showToast({ title: err.message || '未能删除', icon: 'none' });
        }
      },
    });
  },
});
