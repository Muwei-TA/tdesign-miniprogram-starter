import { fetchMyAppeals, createAppeal } from '../governance';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    session: null,
    accessState: 'checking',
    postId: '',
    contentVersion: '',
    reason: '',
    appeals: [],
    loading: false,
    submitting: false,
    errorText: '',
  },

  onLoad(options = {}) {
    const parsedVersion = Number(options.version);
    this.setData({
      postId: options.postId || '',
      contentVersion: Number.isInteger(parsedVersion) && parsedVersion > 0 ? String(parsedVersion) : '',
    });
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

  applySession(session) {
    if (!session) return;
    const allowed = !!session.user;
    this.setData({ session, accessState: allowed ? 'allowed' : 'denied' }, () => {
      if (allowed && !this.data.loading) this.loadAppeals();
    });
  },

  async loadAppeals({ silent = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    this.setData({ loading: true, ...(silent ? {} : { errorText: '' }) });
    try {
      const result = await fetchMyAppeals({ limit: 50 });
      this.setData({ appeals: result.items || [], loading: false, errorText: '' });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '申诉记录暂时无法读取。' });
      if (err.kind === 'unauthenticated') this.setData({ accessState: 'denied' });
    }
  },

  onRetry() {
    this.loadAppeals();
  },

  onMyContent() {
    navigateTo('/pages/community/my-content/index?tab=pending');
  },

  onPostIdInput(e) {
    this.setData({ postId: e.detail.value });
  },

  onVersionInput(e) {
    this.setData({ contentVersion: e.detail.value });
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const postId = String(this.data.postId || '').trim();
    const contentVersion = Number(this.data.contentVersion);
    const reason = String(this.data.reason || '').trim();
    if (!postId) {
      wx.showToast({ title: '请填写内容 ID', icon: 'none' });
      return;
    }
    if (!Number.isInteger(contentVersion) || contentVersion < 1) {
      wx.showToast({ title: '请填写有效的内容版本', icon: 'none' });
      return;
    }
    if (!reason) {
      wx.showToast({ title: '请填写申诉理由', icon: 'none' });
      return;
    }
    if (reason.length > 1000) {
      wx.showToast({ title: '申诉理由最多 1000 字', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, errorText: '' });
    try {
      await createAppeal({ postId, contentVersion, reason });
      this.setData({ submitting: false, reason: '' });
      wx.showToast({ title: '申诉已提交', icon: 'none' });
      this.loadAppeals({ silent: true });
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '申诉暂时无法提交', icon: 'none' });
    }
  },
});
