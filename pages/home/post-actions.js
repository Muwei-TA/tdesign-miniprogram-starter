/** 首页帖子操作流程：权限提示、确认操作、乐观更新与失败回滚。 */
export function createHomePostActions({ shrinkVisibility, deletePost, toggleReaction, toggleBookmark, app, wx }) {
  function onMore(e) {
    const post = this.data.list.find((item) => item.id === e.detail.id);
    const viewer = post && post.viewer ? post.viewer : {};
    if (!post || !viewer.isOwner) return;

    const actions = [];
    if (viewer.canShrinkVisibility) actions.push({ key: 'shrink', label: '缩小可见范围' });
    if (viewer.canDelete) actions.push({ key: 'delete', label: '删除' });
    if (actions.length === 0) return;

    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: ({ tapIndex }) => {
        const action = actions[tapIndex];
        if (!action) return;
        if (action.key === 'shrink') {
          this.setData({ actionPost: post, scopeValue: post.visibility, scopeVisible: true });
          return;
        }
        this.confirmDeletePost(post);
      },
    });
  }

  function onScopeClose() {
    this.setData({ scopeVisible: false, actionPost: null });
  }

  function onScopeChange(e) {
    const post = this.data.actionPost;
    const visibility = e.detail.value;
    const allowedTargets = {
      public: ['club', 'private'],
      club: ['private'],
      private: [],
    };
    const viewer = post && post.viewer ? post.viewer : {};
    this.setData({ scopeVisible: false });

    if (
      !post ||
      !viewer.isOwner ||
      !viewer.canShrinkVisibility ||
      !(allowedTargets[post.visibility] || []).includes(visibility)
    ) {
      this.setData({ actionPost: null });
      wx.showToast({ title: '只能选择更小的可见范围', icon: 'none' });
      return;
    }
    if (!Number.isInteger(post.version)) {
      this.setData({ actionPost: null });
      wx.showToast({ title: '内容已更新，请刷新后重试', icon: 'none' });
      this.loadFeed({ silent: true });
      return;
    }

    const labelMap = { club: '仅社内可见', private: '只有自己可见' };
    wx.showModal({
      title: '缩小可见范围',
      content: `改为「${labelMap[visibility]}」后，原受众将无法再看到这条内容。已经保存的截图无法追回。`,
      confirmText: '确认缩小',
      success: async (res) => {
        if (!res.confirm) {
          this.setData({ actionPost: null });
          return;
        }
        try {
          await shrinkVisibility(post.id, visibility, post.version);
          this.removePostAndRefresh(post.id, 'visibility');
          wx.showToast({ title: '已更新可见范围', icon: 'none' });
        } catch (err) {
          this.setData({ actionPost: null });
          wx.showToast({ title: err.message || '未能更新', icon: 'none' });
          this.loadFeed({ silent: true });
        }
      },
    });
  }

  function confirmDeletePost(post) {
    const viewer = post && post.viewer ? post.viewer : {};
    if (!post || !viewer.isOwner || !viewer.canDelete) return;
    if (!Number.isInteger(post.version)) {
      wx.showToast({ title: '内容已更新，请刷新后重试', icon: 'none' });
      this.loadFeed({ silent: true });
      return;
    }

    wx.showModal({
      title: '删除这条内容',
      content: '删除后无法恢复，相关回应也会一并停止展示。',
      confirmText: '删除',
      confirmColor: '#A85648',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deletePost(post.id, post.version);
          this.removePostAndRefresh(post.id, 'delete');
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err.message || '未能删除', icon: 'none' });
          this.loadFeed({ silent: true });
        }
      },
    });
  }

  function removePostAndRefresh(id, action) {
    this.setData({
      list: this.data.list.filter((item) => item.id !== id),
      actionPost: null,
      scopeVisible: false,
    });
    app.eventBus.emit('post-changed', { id, action });
  }

  async function onReact(e) {
    await this.optimistic(e.detail.id, 'reacted', e.detail.next, 'reactions', toggleReaction);
  }

  async function onBookmark(e) {
    await this.optimistic(e.detail.id, 'bookmarked', e.detail.next, null, toggleBookmark);
  }

  /** 乐观更新 + 失败回滚，避免误触后无反馈 */
  async function optimistic(id, flagKey, next, counterKey, action) {
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const post = this.data.list[index];
    const prevFlag = post.viewer[flagKey];
    const prevCount = counterKey ? post.counters[counterKey] : null;

    const patch = { [`list[${index}].viewer.${flagKey}`]: next };
    if (counterKey) patch[`list[${index}].counters.${counterKey}`] = Math.max(0, prevCount + (next ? 1 : -1));
    this.setData(patch);

    try {
      await action(id, next);
    } catch (err) {
      const rollback = { [`list[${index}].viewer.${flagKey}`]: prevFlag };
      if (counterKey) rollback[`list[${index}].counters.${counterKey}`] = prevCount;
      this.setData(rollback);
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  }

  return {
    onMore,
    onScopeClose,
    onScopeChange,
    confirmDeletePost,
    removePostAndRefresh,
    onReact,
    onBookmark,
    optimistic,
  };
}
