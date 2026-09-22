import {
  QUEUES,
  fetchQueue,
  fetchAssetReviewStatuses,
  submitDecision,
  decideTopic,
  decideMembership,
  decideReport,
  decideCollection,
} from '~/services/moderation';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const QUEUE_HINTS = {
  content: '只处理公开或社内、正在等待审核的内容。',
  topic: '确认社内话题是否可以进入话题广场。',
  member: '处理入社申请，批准后成员资格才会生效。',
  report: '举报不等于违规事实，处理决定需要留下理由。',
  collection: '按作者授权与范围交集处理文集收录申请。',
};

const ACTION_CONFIRM_TEXT = {
  approve: '确认通过这条申请？',
  archive: '确认归档这个话题？',
  include: '确认将这篇文章收录进文集？',
  keep: '确认保留当前内容？',
};

function canAccess(session) {
  return !!session
    && session.memberStatus === 'active'
    && (session.role === 'admin' || session.role === 'moderator');
}

Page({
  data: {
    queues: QUEUES,
    activeQueue: 'content',
    queueHint: QUEUE_HINTS.content,
    items: [],
    nextCursor: null,
    accessState: 'checking',
    loading: false,
    loadingMore: false,
    errorText: '',
    reasonSheetVisible: false,
    reason: '',
    pendingAction: null,
    actionBusy: false,
    mediaSheetVisible: false,
    mediaLoading: false,
    mediaItems: [],
    mediaTitle: '',
  },

  onLoad() {
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);

    // app.js 完成冷启动后才决定深链是否可以进入管理台。
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    this.loadQueue().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loading && !this.data.loadingMore) {
      this.loadQueue({ append: true });
    }
  },

  applySession(session) {
    if (!session) return;
    if (!canAccess(session)) {
      this.setData({
        accessState: 'denied',
        items: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
      });
      return;
    }

    const shouldLoad = this.data.accessState !== 'allowed';
    this.setData({ accessState: 'allowed' }, () => {
      if (shouldLoad) this.loadQueue();
    });
  },

  async loadQueue({ append = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    if (append && !this.data.nextCursor) return;

    const queue = this.data.activeQueue;
    const cursor = append ? this.data.nextCursor : '';
    this.setData({
      ...(append ? { loadingMore: true } : { loading: true, errorText: '' }),
    });

    try {
      const data = await fetchQueue({ queue, cursor });
      // 切换队列后，旧请求的结果不能覆盖当前队列。
      if (queue !== this.data.activeQueue) return;
      const items = append ? this.data.items.concat(data.items || []) : data.items || [];
      this.setData({
        items,
        nextCursor: data.nextCursor || null,
        loading: false,
        loadingMore: false,
        errorText: '',
      });
    } catch (err) {
      if (queue !== this.data.activeQueue) return;
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', items: [], nextCursor: null });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        errorText: err.message || '管理队列暂时没能打开',
      });
    }
  },

  onQueueTap(e) {
    const { queue } = e.currentTarget.dataset;
    if (!queue || queue === this.data.activeQueue) return;
    this.setData(
      {
        activeQueue: queue,
        queueHint: QUEUE_HINTS[queue] || '',
        items: [],
        nextCursor: null,
        errorText: '',
      },
      () => this.loadQueue(),
    );
  },

  onRetry() {
    this.loadQueue();
  },

  onMembersPage() {
    navigateTo('/pages/admin/members/index');
  },

  onAppealsPage() {
    navigateTo('/pages/admin/appeals/index');
  },

  onItemAction(e) {
    const { id, key } = e.detail || {};
    const item = this.data.items.find((entry) => entry.id === id);
    if (!item || this.data.actionBusy) return;
    const action = (item.actions || []).find((entry) => entry.key === key);
    if (!action) return;

    this.setData({
      pendingAction: { id, key, label: action.label },
      reason: '',
    });
    if (action.requiresReason) {
      this.setData({ reasonSheetVisible: true });
      return;
    }
    this.confirmAction(item, key, '');
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  onReasonCancel() {
    if (this.data.actionBusy) return;
    this.setData({ reasonSheetVisible: false, pendingAction: null, reason: '' });
  },

  onMediaClose() {
    if (this.data.mediaLoading) return;
    this.setData({ mediaSheetVisible: false, mediaItems: [], mediaTitle: '' });
  },

  onReasonSubmit() {
    const reason = String(this.data.reason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写处理理由', icon: 'none' });
      return;
    }
    if (reason.length > 200) {
      wx.showToast({ title: '处理理由最多 200 字', icon: 'none' });
      return;
    }

    const pending = this.data.pendingAction;
    const item = pending && this.data.items.find((entry) => entry.id === pending.id);
    if (!item) {
      this.onReasonCancel();
      return;
    }

    this.confirmAction(item, pending.key, reason);
  },

  confirmAction(item, key, reason) {
    const action = (item.actions || []).find((entry) => entry.key === key);
    const content = reason ? '提交后会记录处理理由，并通知相关用户。确认继续？' : ACTION_CONFIRM_TEXT[key] || '确认提交这个处理决定？';
    wx.showModal({
      title: action ? action.label : '处理决定',
      content,
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) this.executeAction(item, key, reason);
      },
    });
  },

  async executeAction(item, key, reason) {
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true, reasonSheetVisible: false });
    try {
      let result;
      if (item.queue === 'content') {
        result = await submitDecision(item.id, {
          decision: key,
          reason,
          expectedVersion: item.version,
        });
      } else if (item.queue === 'topic') {
        result = await decideTopic(item.id, { decision: key, reason });
      } else if (item.queue === 'member') {
        result = await decideMembership(item.id, { decision: key, reason });
      } else if (item.queue === 'report') {
        result = await decideReport(item.id, { decision: key, reason });
      } else if (item.queue === 'collection') {
        result = await decideCollection(item.id, { decision: key, reason });
      }

      if (result) {
        this.setData({
          items: this.data.items.filter((entry) => entry.id !== item.id),
          pendingAction: null,
          reason: '',
          actionBusy: false,
        });
        wx.showToast({ title: '已提交处理决定', icon: 'none' });
      }
    } catch (err) {
      this.setData({ actionBusy: false, pendingAction: null, reason: '' });
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', items: [], nextCursor: null });
        return;
      }
      if (err.kind === 'conflict') {
        wx.showToast({ title: '条目已被别人处理，请刷新', icon: 'none' });
        this.loadQueue();
        return;
      }
      wx.showToast({ title: err.message || '处理未完成，请稍后重试', icon: 'none' });
    }
  },

  async onItemDetail(e) {
    const item = this.data.items.find((entry) => entry.id === e.detail.id);
    if (!item) return;
    if (!item.assetIds.length) {
      wx.showModal({
        title: item.title || '管理条目',
        content: item.summary || '暂无摘要',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    this.setData({ mediaSheetVisible: true, mediaLoading: true, mediaItems: [], mediaTitle: item.title || '审核附件' });
    try {
      const mediaItems = await fetchAssetReviewStatuses(item.assetIds);
      this.setData({ mediaItems, mediaLoading: false });
    } catch (err) {
      this.setData({ mediaLoading: false, mediaSheetVisible: false });
      wx.showToast({ title: err.message || '附件状态暂时无法读取', icon: 'none' });
    }
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.url;
    const urls = this.data.mediaItems
      .filter((item) => item.mediaType === 'image' && item.url)
      .map((item) => item.url);
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  onStopPropagation() {},
});
