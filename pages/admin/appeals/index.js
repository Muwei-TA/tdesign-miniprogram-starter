import { fetchAdminAppeals, decideAppeal } from '~/services/governance';

const app = getApp();

function canAccess(session) {
  return !!session
    && session.memberStatus === 'active'
    && (session.role === 'admin' || session.role === 'moderator');
}

Page({
  data: {
    session: null,
    accessState: 'checking',
    appeals: [],
    loading: false,
    errorText: '',
    reasonSheetVisible: false,
    pendingAction: null,
    reason: '',
    actionBusy: false,
  },

  onLoad() {
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (this.data.accessState === 'allowed') this.loadAppeals({ silent: true });
  },

  onPullDownRefresh() {
    this.loadAppeals().finally(() => wx.stopPullDownRefresh());
  },

  applySession(session) {
    if (!session) return;
    if (!canAccess(session)) {
      this.setData({ session, accessState: 'denied', appeals: [], loading: false });
      return;
    }
    const firstLoad = this.data.accessState !== 'allowed';
    this.setData({ session, accessState: 'allowed' }, () => {
      if (firstLoad) this.loadAppeals();
    });
  },

  async loadAppeals({ silent = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    this.setData({ loading: true, ...(silent ? {} : { errorText: '' }) });
    try {
      const result = await fetchAdminAppeals({ limit: 50 });
      this.setData({ appeals: result.items || [], loading: false, errorText: '' });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '申诉队列暂时无法读取。' });
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', appeals: [] });
      }
    }
  },

  onRetry() {
    this.loadAppeals();
  },

  onActionTap(e) {
    if (this.data.actionBusy) return;
    const { id, decision } = e.currentTarget.dataset;
    const appeal = this.data.appeals.find((item) => item.appealId === id);
    if (!appeal || appeal.status !== 'submitted') return;
    this.setData({
      pendingAction: { appealId: id, decision },
      reason: '',
      reasonSheetVisible: true,
    });
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  onReasonCancel() {
    if (this.data.actionBusy) return;
    this.setData({ reasonSheetVisible: false, pendingAction: null, reason: '' });
  },

  onStopPropagation() {},

  onReasonSubmit() {
    if (this.data.actionBusy) return;
    const reason = String(this.data.reason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写决定理由', icon: 'none' });
      return;
    }
    if (reason.length > 500) {
      wx.showToast({ title: '决定理由最多 500 字', icon: 'none' });
      return;
    }
    const pending = this.data.pendingAction;
    if (!pending) return;
    this.setData({ actionBusy: true, reasonSheetVisible: false });
    const isApprove = pending.decision === 'approve';
    wx.showModal({
      title: isApprove ? '批准并重新待审' : '驳回申诉',
      content: isApprove
        ? '批准只会把内容重新置为待审，并创建新的安全审核任务，不会直接公开。确认继续？'
        : '决定理由会通知申诉作者。确认驳回？',
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) this.executeAction(pending, reason);
        else this.resetAction();
      },
      fail: () => this.resetAction(),
    });
  },

  async executeAction(pending, reason) {
    const appeal = this.data.appeals.find((item) => item.appealId === pending.appealId);
    if (!appeal) {
      this.resetAction();
      return;
    }
    try {
      await decideAppeal(appeal.appealId, {
        expectedVersion: appeal.version,
        decision: pending.decision,
        reason,
      });
      this.setData({ appeals: this.data.appeals.filter((item) => item.appealId !== appeal.appealId) });
      this.resetAction();
      wx.showToast({ title: pending.decision === 'approve' ? '已批准并重新待审' : '申诉已驳回', icon: 'none' });
    } catch (err) {
      this.resetAction();
      if (err.kind === 'conflict') {
        wx.showToast({ title: '申诉状态已变化，请刷新', icon: 'none' });
        this.loadAppeals();
      } else {
        wx.showToast({ title: err.message || '申诉处理未完成', icon: 'none' });
      }
    }
  },

  resetAction() {
    this.setData({ actionBusy: false, reasonSheetVisible: false, pendingAction: null, reason: '' });
  },
});
