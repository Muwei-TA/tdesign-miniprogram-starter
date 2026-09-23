import { fetchTopicDetail, toggleFollow } from '~/services/topics';
import { previewPostImage } from '~/services/image-preview';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

function showAnonymousNotice() {
  wx.showModal({
    title: '树洞身份',
    content:
      '这条内容以树洞身份发布，其他人看不到作者的昵称与头像。这不是绝对匿名——具体经历、地名与文风仍可能让人猜到。',
    showCancel: false,
    confirmText: '我知道了',
  });
}

Page({
  data: {
    id: '',
    topic: null,
    list: [],
    canPost: false,
    isMember: false,
    loading: true,
    stale: false,
    errorText: '',
    errorKind: '',
    followBusy: false,
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this.syncSession(getSession());
    this.onSessionChanged = (session) => this.syncSession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);

    if (this.data.id) this.loadDetail();
    else this.setData({ loading: false, errorText: '当前话题不可访问', errorKind: 'not_accessible' });
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    this.loadDetail().then(() => wx.stopPullDownRefresh());
  },

  syncSession(session) {
    if (!session) return;
    this.setData({ isMember: session.memberStatus === 'active' });
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true, errorText: '', errorKind: '' });
    try {
      const data = (await fetchTopicDetail(this.data.id)) || {};
      const topic = data.topic || null;
      if (!topic) {
        const err = new Error('当前话题不可访问');
        err.kind = 'not_accessible';
        throw err;
      }
      this.setData({
        topic,
        list: data.items || [],
        canPost: !!data.canPost,
        loading: false,
        stale: false,
        errorText: '',
        errorKind: '',
      });
    } catch (err) {
      this.setData({
        loading: false,
        stale: !!this.data.topic || this.data.list.length > 0,
        errorText: err.message || '加载失败',
        errorKind: err.kind || '',
      });
    }
  },

  async onFollow() {
    const { topic } = this.data;
    if (!topic || topic.status !== 'active' || this.data.followBusy) return;
    if (!this.data.isMember) {
      this.askJoin();
      return;
    }

    const next = !topic.followed;
    this.setData({ 'topic.followed': next, followBusy: true });
    try {
      await toggleFollow(this.data.id, next);
      this.setData({ followBusy: false });
    } catch (err) {
      this.setData({ 'topic.followed': !next, followBusy: false });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  },

  askJoin() {
    wx.showModal({
      title: '需要成员资格',
      content: '关注话题和参与共写需要先加入文学社。',
      confirmText: '去了解',
      success: (res) => {
        if (res.confirm) navigateTo('/pages/community/join/index?from=topic');
      },
    });
  },

  onWrite() {
    const { topic } = this.data;
    if (!topic) return;
    if (!this.data.isMember) {
      this.askJoin();
      return;
    }
    if (topic.status !== 'active') {
      wx.showToast({
        title: topic.status === 'archived' ? '话题已归档，暂不能新增内容' : '话题尚未开放参与',
        icon: 'none',
      });
      return;
    }
    if (!this.data.canPost) {
      wx.showToast({ title: '当前不能参与这个话题', icon: 'none' });
      return;
    }
    // 只传 topicId；身份和可见范围由发布页交给作者选择。
    navigateTo(`/pages/release/index?topicId=${encodeURIComponent(this.data.id)}`);
  },

  onTapBody(e) {
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(e.detail.id)}&from=topic`);
  },

  onTapMedia(e) {
    const { id, index, type } = e.detail;
    if (type === 'image') {
      previewPostImage(id, index);
      return;
    }
    navigateTo(`/pages/community/post/index?id=${encodeURIComponent(id)}&from=topic`);
  },

  onTapAuthor(e) {
    const { userId, isAnonymous } = e.detail;
    if (isAnonymous || !userId) {
      showAnonymousNotice();
      return;
    }
    navigateTo(`/pages/community/profile/index?userId=${encodeURIComponent(userId)}`);
  },

  onTapTopic() {},

  onRetry() {
    this.loadDetail();
  },
});
