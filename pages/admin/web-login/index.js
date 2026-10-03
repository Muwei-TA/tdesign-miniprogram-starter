import Page from '~/utils/themed-page';
import { fetchInitialSession } from '~/services/session';
import { approveWebLogin, fetchWebLoginInfo, rejectWebLogin } from '../governance';
import { createWebLoginFlow, describeApprovalScope } from './helpers';

const app = getApp();
const STATUS_TEXT = {
  idle: '扫描 Web 登录二维码',
  checking: '正在读取登录请求…',
  pending: '请核对登录来源与权限范围',
  approved: '已批准这次 Web 登录',
  rejected: '已拒绝这次 Web 登录',
  expired: '登录请求已过期',
  invalid: '登录请求无效',
};

function formatExpiry(value) {
  if (!value) return '未提供';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sessionUserId(session) {
  return session && session.user && session.user.id || '';
}

Page({
  data: {
    identity: '',
    scopeText: '',
    id: '',
    origin: '',
    expiresAt: '',
    status: 'idle',
    statusText: STATUS_TEXT.idle,
    busy: false,
    errorText: '',
  },

  onLoad() {
    this.flow = createWebLoginFlow({
      fetchInfo: fetchWebLoginInfo,
      approve: approveWebLogin,
      reject: rejectWebLogin,
    });
    this.identityUserId = '';
    this.identityRequestId = 0;
    this.identityCheckId = 0;
    this.hasShownOnce = false;
    return this.refreshIdentity();
  },

  onShow() {
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    return this.refreshIdentity();
  },

  onUnload() {
    this.identityRequestId += 1;
    this.identityCheckId += 1;
  },

  async refreshIdentity() {
    const checkId = this.identityCheckId + 1;
    this.identityCheckId = checkId;
    this.setData({ identity: '', scopeText: '' });
    try {
      const accountSession = await fetchInitialSession();
      if (checkId !== this.identityCheckId) return;
      const userId = sessionUserId(accountSession);
      if (!userId) throw new Error('请先完成小程序账号登录。');
      const accountChanged = !!this.identityUserId && this.identityUserId !== userId;
      if (accountChanged) this.clearPairingState();
      this.identityUserId = userId;
      const appSession = app.globalData && app.globalData.session;
      const scopeSession = sessionUserId(appSession) === userId ? appSession : accountSession;
      const identity = describeApprovalScope(scopeSession);
      this.setData({
        identity: identity.account,
        scopeText: identity.scope,
        ...(accountChanged ? { errorText: '当前账号已切换，请核对新账号后重新扫描。' } : {}),
      });
    } catch (err) {
      if (checkId !== this.identityCheckId) return;
      this.clearIdentityContext(err.message || '暂时无法确认当前小程序账号。');
    }
  },

  clearPairingState() {
    this.identityRequestId += 1;
    if (this.flow) this.flow.clear();
    this.setData({
      id: '', origin: '', expiresAt: '', status: 'idle', statusText: STATUS_TEXT.idle,
      busy: false,
    });
  },

  clearIdentityContext(message) {
    this.identityUserId = '';
    this.clearPairingState();
    this.setData({ identity: '', scopeText: '', errorText: message || '' });
  },

  async confirmIdentity(requestId, expectedUserId) {
    let session;
    try {
      session = await fetchInitialSession();
    } catch (err) {
      if (requestId !== this.identityRequestId) return false;
      this.clearIdentityContext('暂时无法确认当前小程序账号，请重新读取后操作。');
      return false;
    }
    if (requestId !== this.identityRequestId) return false;
    if (sessionUserId(session) !== expectedUserId) {
      this.clearIdentityContext('当前账号已切换，请重新确认账号后扫描登录二维码。');
      return false;
    }
    return true;
  },

  onScanTap() {
    if (this.data.busy) return;
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (result) => {
        this.flow.clear();
        this.setData({ id: '', origin: '', expiresAt: '', status: 'idle', statusText: STATUS_TEXT.idle });
        this.loadPairing(result && result.result);
      },
      fail: (err) => {
        if (!/cancel/i.test((err && err.errMsg) || '')) {
          wx.showToast({ title: '扫码未完成，请重试', icon: 'none' });
        }
      },
    });
  },

  async loadPairing(value) {
    const requestId = this.identityRequestId + 1;
    this.identityRequestId = requestId;
    const expectedUserId = this.identityUserId;
    if (!expectedUserId) {
      this.setData({ errorText: '请先完成小程序账号登录。' });
      return;
    }
    this.setData({ busy: true, status: 'checking', statusText: STATUS_TEXT.checking, errorText: '' });
    try {
      const { flow } = this;
      const state = await flow.scan(value);
      if (!await this.confirmIdentity(requestId, expectedUserId)) return;
      this.setData({
        id: state.id,
        origin: state.info.origin,
        expiresAt: formatExpiry(state.info.expiresAt),
        status: state.status,
        statusText: STATUS_TEXT[state.status] || STATUS_TEXT.invalid,
        busy: false,
      });
    } catch (err) {
      if (requestId !== this.identityRequestId) return;
      if (!await this.confirmIdentity(requestId, expectedUserId)) return;
      this.setData({
        id: this.flow.state.id,
        status: this.flow.state.status,
        statusText: STATUS_TEXT[this.flow.state.status] || STATUS_TEXT.invalid,
        busy: false,
        errorText: err.message || '登录请求暂时无法读取。',
      });
    }
  },

  onDecisionTap(event) {
    if (this.data.busy || this.data.status !== 'pending' || !this.data.identity) {
      wx.showToast({ title: '请先确认当前小程序账号', icon: 'none' });
      return;
    }
    const { decision } = event.currentTarget.dataset;
    const isApprove = decision === 'approve';
    wx.showModal({
      title: isApprove ? '批准 Web 登录' : '拒绝 Web 登录',
      content: `${this.data.origin}\n${this.data.scopeText}`,
      confirmText: isApprove ? '批准登录' : '确认拒绝',
      confirmColor: isApprove ? '#315948' : '#a85648',
      success: (result) => {
        if (result.confirm) this.submitDecision(decision);
      },
    });
  },

  async submitDecision(decision) {
    const requestId = this.identityRequestId;
    const expectedUserId = this.identityUserId;
    if (!expectedUserId || !await this.confirmIdentity(requestId, expectedUserId)) return;
    this.setData({ busy: true, errorText: '' });
    try {
      const state = await this.flow.decide(decision);
      if (!await this.confirmIdentity(requestId, expectedUserId)) return;
      this.setData({ status: state.status, statusText: STATUS_TEXT[state.status], busy: false });
    } catch (err) {
      if (requestId !== this.identityRequestId) return;
      if (!await this.confirmIdentity(requestId, expectedUserId)) return;
      this.setData({ busy: false, errorText: err.message || '处理未完成，请重新读取登录请求。' });
      if (err.kind === 'conflict') {
        this.flow.clear();
        this.setData({ id: '', origin: '', expiresAt: '', status: 'idle', statusText: STATUS_TEXT.idle });
      }
    }
  },

  onScanAgain() {
    if (this.data.busy) return;
    this.clearPairingState();
    this.setData({ errorText: '' });
  },
});
