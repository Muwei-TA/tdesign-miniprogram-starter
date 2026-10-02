import {
  fetchQueue,
  fetchAssetReviewStatuses,
  submitDecision,
  decideComment,
  decideTopic,
  decideMembership,
  decideReport,
  decideCollection,
} from '../moderation';
import { decideBoard } from '~/services/boards';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const ACTION_CONFIRM_TEXT = {
  approve: '确认通过这条申请？',
  approveBoard: '确认通过这个板块？',
  rejectBoard: '确认退回这个板块？',
  archive: '确认归档这个话题？',
  include: '确认将这篇文章收录进文集？',
  keep: '确认保留当前内容？',
};

function canAccess(session) {
  return !!session
    && !!session.club
    && session.memberStatus === 'active'
    && (session.role === 'admin' || session.role === 'moderator');
}

function sessionScope(session) {
  return session ? [session.user && session.user.id, session.club && session.club.id, session.role, session.memberStatus].join(':') : '';
}

Page({
  data: {
    session: null,
    activeQueue: 'all',
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
    this.hasShownOnce = false;
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);

    // app.js 完成冷启动后才决定深链是否可以进入管理台。
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    this.queueRequestId = (this.queueRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    if (this.data.accessState === 'allowed') this.loadQueue();
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
    const changed = this.sessionScope !== sessionScope(session);
    this.sessionScope = sessionScope(session);
    if (changed) {
      this.queueRequestId = (this.queueRequestId || 0) + 1;
      this.setData({ items: [], nextCursor: null, loading: false, loadingMore: false, errorText: '',
        reasonSheetVisible: false, pendingAction: null, mediaItems: [], mediaTitle: '' });
    }
    if (!canAccess(session)) {
      this.queueRequestId = (this.queueRequestId || 0) + 1;
      this.setData({
        session,
        accessState: 'denied',
        items: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
      });
      return;
    }

    const shouldLoad = changed || this.data.accessState !== 'allowed';
    this.setData({ session, accessState: 'allowed' }, () => {
      if (shouldLoad) {
        this.loadQueue();
      }
    });
  },

  async loadQueue({ append = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    if (append && !this.data.nextCursor) return;

    const queue = this.data.activeQueue;
    const requestId = (this.queueRequestId || 0) + 1;
    this.queueRequestId = requestId;
    const cursor = append ? this.data.nextCursor : '';
    this.setData({
      ...(append ? { loadingMore: true } : { loading: true, errorText: '' }),
    });

    try {
      const data = await fetchQueue({ queue, cursor });
      if (requestId !== this.queueRequestId) return;
      const queueItems = data.items || [];
      const items = append ? this.data.items.concat(queueItems) : queueItems;
      this.setData({
        items,
        nextCursor: data.nextCursor || null,
        loading: false,
        loadingMore: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.queueRequestId) return;
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

  onRetry() {
    this.loadQueue();
  },

  onManagementPage() {
    navigateTo('/pages/admin/index');
  },

  onItemAction(e) {
    const { id, queue, key } = e.detail || {};
    const item = this.data.items.find((entry) => entry.id === id && entry.queue === queue);
    if (!item || this.data.actionBusy) return;
    const action = (item.actions || []).find((entry) => entry.key === key);
    if (!action) return;

    this.setData({
      pendingAction: { id, queue, key, label: action.label },
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
    const item = pending && this.data.items.find((entry) => entry.id === pending.id && entry.queue === pending.queue);
    if (!item) {
      this.onReasonCancel();
      return;
    }

    this.confirmAction(item, pending.key, reason);
  },

  confirmAction(item, key, reason) {
    const action = (item.actions || []).find((entry) => entry.key === key);
    const boardConfirmText = key === 'approve' ? ACTION_CONFIRM_TEXT.approveBoard : ACTION_CONFIRM_TEXT.rejectBoard;
    let content;
    if (reason) {
      content = item.queue === 'board'
        ? '提交后会记录处理理由。确认继续？'
        : '提交后会记录处理理由，并通知相关用户。确认继续？';
    } else {
      content = (item.queue === 'board' ? boardConfirmText : ACTION_CONFIRM_TEXT[key])
        || '确认提交这个处理决定？';
    }
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
      } else if (item.queue === 'comment') {
        result = await decideComment(item.id, { decision: key, reason, expectedVersion: item.version });
      } else if (item.queue === 'topic') {
        result = await decideTopic(item.id, { decision: key, reason, expectedVersion: item.version });
      } else if (item.queue === 'board') {
        result = await decideBoard(item.id, { decision: key, reason, expectedVersion: item.version });
      } else if (item.queue === 'member') {
        result = await decideMembership(item.id, { decision: key, reason, expectedVersion: item.version });
      } else if (item.queue === 'report') {
        result = await decideReport(item.id, { decision: key, reason, expectedVersion: item.version });
      } else if (item.queue === 'collection') {
        result = await decideCollection(item.id, { decision: key, reason, expectedVersion: item.version });
      }

      if (result) {
        this.setData({
          items: this.data.items.filter((entry) => entry.id !== item.id || entry.queue !== item.queue),
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
    const item = this.data.items.find((entry) => entry.id === e.detail.id && entry.queue === e.detail.queue);
    if (!item) return;
    if (item.queue === 'appeals') {
      navigateTo('/pages/admin/appeals/index');
      return;
    }
    if (item.queue === 'content') {
      navigateTo(`/pages/community/post/index?id=${encodeURIComponent(item.id)}&from=admin`);
      return;
    }
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

  async onPreviewImage(e) {
    const { assetId } = e.currentTarget.dataset;
    if (this.data.accessState !== 'allowed' || !assetId) return;
    try {
      const ids = this.data.mediaItems.filter((item) => item.mediaType === 'image').map((item) => item.assetId);
      const mediaItems = await fetchAssetReviewStatuses(ids);
      const selected = mediaItems.find((item) => item.assetId === assetId);
      if (this.data.accessState !== 'allowed' || !selected || !selected.url) {
        wx.showToast({ title: '图片当前不可访问', icon: 'none' });
        return;
      }
      const urls = mediaItems.filter((item) => item.mediaType === 'image' && item.url).map((item) => item.url);
      wx.previewImage({
        current: selected.url,
        urls,
        fail: () => wx.showToast({ title: '图片打开失败，请重试', icon: 'none' }),
      });
    } catch (err) {
      wx.showToast({ title: '图片刷新失败，请重试', icon: 'none' });
    }
  },

  onStopPropagation() {},
});
