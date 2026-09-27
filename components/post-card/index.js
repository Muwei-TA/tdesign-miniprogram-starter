function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * 内容卡（碎片 / 文章 / 视频 / 活动）。
 *
 * 硬约束（docs/07 7.3）：
 * 1. 只渲染入参、只抛事件；不请求数据、不判断业务权限。
 * 2. 匿名作者不渲染 userId，tapauthor 载荷 userId = null。
 * 3. private 内容与非 published 状态不渲染互动区（由 post.visibility/status 驱动）。
 * 4. 互动按钮用 catchtap 阻断冒泡，避免点赞误入详情。
 */
Component({
  options: { styleIsolation: 'shared' },

  properties: {
    post: { type: Object, value: null },
    /** feed | article | compact | mine */
    mode: { type: String, value: 'feed' },
    showActions: { type: Boolean, value: true },
    /** 可读文章的回应入口可展示给访客；共鸣与收藏仅对有效成员启用。 */
    canInteract: { type: Boolean, value: true },
  },

  data: {
    avatarText: '',
    authorText: '',
    showInteractions: false,
    showMemberActions: true,
    showComments: true,
    showMoreActions: false,
    isGrid: false,
    durationText: '',
  },

  observers: {
    'post, showActions, mode, canInteract': function observePost() {
      const { post, showActions, mode, canInteract } = this.data;
      if (!post) return;

      const author = post.author || {};
      const viewer = post.viewer || {};
      const name = author.isAnonymous ? author.alias || '树洞旅人' : author.displayName || '';
      const media = post.media || {};
      const video = media.video || null;

      this.setData({
        authorText: name,
        avatarText: name.slice(0, 1),
        // private 不参与社区互动；非 published 状态只显示状态标签
        showInteractions: showActions && post.visibility !== 'private' && post.status === 'published',
        showMemberActions: !!canInteract,
        // 不可发表评论的读者仍能通过已有回应数进入详情阅读。
        showComments: mode !== 'article' || !!viewer.canComment || !!(post.counters && post.counters.comments > 0),
        // 管理入口只由服务端返回的本人权限决定，不跟随互动区显隐。
        showMoreActions: showActions && viewer.isOwner && (viewer.canDelete || viewer.canShrinkVisibility),
        isGrid: media.type === 'image' && (media.images || []).length > 1,
        durationText: video ? formatDuration(video.duration) : '',
      });
    },
  },

  methods: {
    onTapBody() {
      this.triggerEvent('tapbody', { id: this.data.post.id });
    },

    onTapMedia(e) {
      const { index = 0 } = e.currentTarget.dataset;
      const media = this.data.post.media || {};
      this.triggerEvent('tapmedia', { id: this.data.post.id, index: Number(index), type: media.type });
    },

    onTapTopic() {
      const { topic } = this.data.post;
      if (topic) this.triggerEvent('taptopic', { topicId: topic.id });
    },

    onTapBoard() {
      const { board } = this.data.post;
      if (board) this.triggerEvent('tapboard', { boardId: board.id });
    },

    onTapAuthor() {
      const author = this.data.post.author || {};
      // 匿名作者不返回 userId，页面据此弹匿名说明而不跳主页
      this.triggerEvent('tapauthor', {
        userId: author.isAnonymous ? null : author.userId || null,
        isAnonymous: !!author.isAnonymous,
      });
    },

    onReact() {
      const { post } = this.data;
      this.triggerEvent('react', { id: post.id, next: !post.viewer.reacted });
    },

    onBookmark() {
      const { post } = this.data;
      this.triggerEvent('bookmark', { id: post.id, next: !post.viewer.bookmarked });
    },

    onMore() {
      this.triggerEvent('more', { id: this.data.post.id });
    },

    onComment() {
      this.triggerEvent('tapbody', { id: this.data.post.id, focusComment: true });
    },
  },
});
