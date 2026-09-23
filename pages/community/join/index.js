import {
  fetchMyMembershipApplication,
  submitMembershipApplication,
} from '../membership';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const DEFAULT_RULES_VERSION = 'v1.1';
const MAX_DISPLAY_NAME_LENGTH = 20;

const STATUS_META = {
  idle: {
    label: '还没有完成入社',
    desc: '填写昵称和有效邀请码，服务端验证通过后即可加入。',
    icon: 'edit-1',
    tone: 'neutral',
  },
  invalid_code: {
    label: '邀请码无效或已过期',
    desc: '请向社团联系人确认最新邀请码，再重新填写。',
    icon: 'error-circle',
    tone: 'danger',
  },
  duplicate: {
    label: '已有一条申请记录',
    desc: '先刷新确认当前状态，避免重复提交邀请码。',
    icon: 'info-circle',
    tone: 'notice',
  },
  pending: {
    label: '入社状态待确认',
    desc: '历史待处理申请或成员资格被移除后的重新申请仍需确认；首次凭有效邀请码会直接加入。',
    icon: 'time',
    tone: 'notice',
  },
  active: {
    label: '你已经是社内成员',
    desc: '现在可以阅读社内内容，也可以写下第一笔。',
    icon: 'check-circle',
    tone: 'success',
  },
  rejected: {
    label: '这次申请没有通过',
    desc: '这不等于你的表达有问题。你可以联系社团管理员了解原因。',
    icon: 'error-circle',
    tone: 'danger',
  },
  confirming: {
    label: '正在确认入社状态',
    desc: '正在从服务端读取当前成员资格，稍后会显示最新状态。',
    icon: 'time',
    tone: 'notice',
  },
  uncertain: {
    label: '入社结果待确认',
    desc: '提交可能已经生效。请先刷新状态确认，不要重复提交邀请码。',
    icon: 'info-circle',
    tone: 'notice',
  },
};

const ORIGIN_TABS = {
  home: '/pages/home/index',
  topics: '/pages/topics/index',
  anthology: '/pages/anthology/index',
  my: '/pages/my/index',
};

function normalizeStatus(value) {
  if (value === 'active' || value === 'approved') return 'active';
  if (value === 'pending') return 'pending';
  if (value === 'rejected' || value === 'removed') return 'rejected';
  if (value === 'duplicate') return 'duplicate';
  return 'idle';
}

function errorTextForLoad(err) {
  if (err && err.kind === 'unauthenticated') return '会话还没有准备好，请稍后重试。';
  if (err && err.kind === 'network') return '网络暂时不可用，已保留当前页面。';
  if (err && err.kind === 'timeout') return '请求超时，社团信息还没有更新。';
  return (err && err.message) || '社团信息暂时无法读取。';
}

function statusForSubmitError(err) {
  if (
    err &&
    err.kind === 'invalid_input' &&
    ((err.detail && err.detail.field === 'inviteCode') || /邀请码/.test(err.message || ''))
  ) {
    return 'invalid_code';
  }
  if (err && err.kind === 'conflict') return 'duplicate';
  return 'uncertain';
}

Page({
  data: {
    from: '',
    session: null,
    club: null,
    status: 'idle',
    statusMeta: STATUS_META.idle,
    statusReason: '',
    appliedAtText: '',
    form: { displayName: '', inviteCode: '' },
    rulesAgreed: false,
    privacyAgreed: false,
    rulesVersion: DEFAULT_RULES_VERSION,
    loading: true,
    loadError: '',
    submitting: false,
    showPendingReapplyForm: false,
  },

  onLoad(options) {
    this.setData({ from: options.from || '' });
    this.awaitingMembershipRefresh = false;
    this.onSessionChanged = (session) => {
      if (this.awaitingMembershipRefresh && session && session.memberStatus !== 'active') {
        this.setData({ session });
        return;
      }
      this.applySession(session);
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    return this.loadPage();
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  async loadPage() {
    this.setData({ loading: true, loadError: '' });
    try {
      const snapshot = await app.refreshSession();
      this.applySession(snapshot);

      if (snapshot && snapshot.user && snapshot.memberStatus !== 'active') {
        await this.loadApplication();
      }
      this.setData({ loading: false });
    } catch (err) {
      this.setData({ loading: false, loadError: errorTextForLoad(err) });
    }
  },

  applySession(session) {
    if (!session) return;
    const nextStatus = normalizeStatus(session.memberStatus);
    if (nextStatus === 'active') this.awaitingMembershipRefresh = false;
    const club = session.club || this.data.club;
    this.setData({
      session,
      club,
      status: nextStatus,
      statusMeta: STATUS_META[nextStatus] || STATUS_META.idle,
      statusReason: nextStatus === 'active' ? '' : this.data.statusReason,
      showPendingReapplyForm: nextStatus === 'active' || nextStatus === 'pending'
        ? false
        : this.data.showPendingReapplyForm,
      rulesVersion: (club && club.rulesVersion) || this.data.rulesVersion,
    });
  },

  applyApplication(application) {
    if (!application) return null;
    const status = normalizeStatus(application.state);
    // Only /session/me can establish active membership; an application DTO cannot promote the UI.
    if (status === 'active' && (!this.data.session || this.data.session.memberStatus !== 'active')) {
      this.setData({
        status: 'uncertain',
        statusMeta: STATUS_META.uncertain,
        statusReason: '申请记录已更新，但当前会话尚未确认成员资格。请刷新状态确认，不要重复提交邀请码。',
      });
      return 'uncertain';
    }
    if (status === 'idle') return null;
    this.setData({
      status,
      statusMeta: STATUS_META[status] || STATUS_META.idle,
      statusReason: application.reason || '',
      appliedAtText: application.appliedAtText || '',
      showPendingReapplyForm: status === 'pending' ? false : this.data.showPendingReapplyForm,
    });
    return status;
  },

  async loadApplication() {
    try {
      const application = await fetchMyMembershipApplication();
      return this.applyApplication(application);
    } catch (err) {
      // 访客可能还没有可查询的账号；此时仍允许阅读介绍并开始授权流程。
      if (err && err.kind !== 'unauthenticated') {
        this.setData({ statusReason: errorTextForLoad(err) });
      }
      return null;
    }
  },

  onRetry() {
    this.loadPage();
  },

  onNameInput(e) {
    this.setData({ 'form.displayName': e.detail.value });
  },

  onInviteInput(e) {
    this.setData({ 'form.inviteCode': e.detail.value });
  },

  onRulesChange(e) {
    this.setData({ rulesAgreed: !!e.detail.value });
  },

  onPrivacyChange(e) {
    this.setData({ privacyAgreed: !!e.detail.value });
  },

  onRulesTap() {
    // 表单只存在当前页面内；navigateTo 返回时不会重建本页，输入自然保留。
    navigateTo('/pages/community/rules/index?from=join');
  },

  onPrivacyTap() {
    wx.showModal({
      title: '隐私告知',
      content:
        '申请只使用微信会话、自选昵称和邀请码。不会索取手机号、位置、学号、通讯录；昵称仅用于社内署名与申请处理。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async ensureSession() {
    if (this.data.session && this.data.session.user) return this.data.session;
    const session = await app.refreshSession();
    this.applySession(session);
    return session;
  },

  validateForm() {
    const displayName = this.data.form.displayName.trim();
    const inviteCode = this.data.form.inviteCode.trim();
    if (!displayName) {
      wx.showToast({ title: '请先填写昵称', icon: 'none' });
      return null;
    }
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      wx.showToast({ title: `昵称最多 ${MAX_DISPLAY_NAME_LENGTH} 个字`, icon: 'none' });
      return null;
    }
    if (!inviteCode) {
      wx.showToast({ title: '请填写邀请码', icon: 'none' });
      return null;
    }
    if (!this.data.rulesAgreed) {
      wx.showToast({ title: '请先阅读并同意社区约定', icon: 'none' });
      return null;
    }
    if (!this.data.privacyAgreed) {
      wx.showToast({ title: '请先阅读并同意隐私告知', icon: 'none' });
      return null;
    }
    return { displayName, inviteCode };
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const form = this.validateForm();
    if (!form) return;

    this.setData({ submitting: true, statusReason: '' });
    let session;
    try {
      session = await this.ensureSession();
      if (!session || !session.user) {
        throw new Error('会话还没有准备好，请稍后重试。');
      }
      if (session.memberStatus === 'active') {
        this.applySession(session);
        this.setData({ submitting: false });
        return;
      }
    } catch (err) {
      this.setData({
        submitting: false,
        statusReason: (err && err.message) || '会话还没有准备好，请稍后重试。',
      });
      return;
    }

    let result;
    try {
      result = await submitMembershipApplication({
        ...form,
        rulesVersion: this.data.rulesVersion,
      });
    } catch (err) {
      const errorStatus = statusForSubmitError(err);
      if (errorStatus === 'invalid_code') {
        this.setData({
          submitting: false,
          status: errorStatus,
          statusMeta: STATUS_META[errorStatus],
          statusReason: (err && err.message) || '',
        });
        return;
      }
      await this.reconcileJoinOutcome(errorStatus === 'duplicate' ? 'duplicate' : null);
      return;
    }

    const resultStatus = normalizeStatus(result && result.state);
    const knownStatus = result && result.state && STATUS_META[resultStatus] && resultStatus !== 'idle'
      ? resultStatus
      : null;
    const finalStatus = await this.reconcileJoinOutcome(knownStatus);
    if (finalStatus === 'active') {
      wx.showToast({ title: '已加入社团', icon: 'success' });
    } else if (finalStatus === 'pending') {
      wx.showToast({ title: '入社状态仍待确认', icon: 'none' });
    }
  },

  async reconcileJoinOutcome(knownStatus = null) {
    this.awaitingMembershipRefresh = true;
    this.setData({
      submitting: true,
      status: 'confirming',
      statusMeta: STATUS_META.confirming,
      statusReason: '',
    });

    try {
      const session = await app.refreshSession();
      this.awaitingMembershipRefresh = false;
      this.applySession(session);

      if (session && session.memberStatus === 'active') return 'active';

      if (session && session.user) {
        const application = await fetchMyMembershipApplication();
        const applicationStatus = this.applyApplication(application);
        if (applicationStatus && applicationStatus !== 'uncertain') return applicationStatus;
      }

      if (session && session.memberStatus === 'pending') return 'pending';
      if (session && ['rejected', 'removed'].includes(session.memberStatus)) return 'rejected';

      if (['pending', 'duplicate', 'rejected'].includes(knownStatus)) {
        this.setData({
          status: knownStatus,
          statusMeta: STATUS_META[knownStatus],
          statusReason: '服务端已收到状态，但成员资格暂未同步。请刷新状态确认，不要重复提交邀请码。',
        });
        return knownStatus;
      }

      this.setData({
        status: 'uncertain',
        statusMeta: STATUS_META.uncertain,
        statusReason: '服务端暂未确认成员资格。请刷新状态确认；不要重复提交邀请码。',
      });
      return 'uncertain';
    } catch (err) {
      const fallbackStatus = ['pending', 'duplicate', 'rejected'].includes(knownStatus)
        ? knownStatus
        : 'uncertain';
      this.setData({
        status: fallbackStatus,
        statusMeta: STATUS_META[fallbackStatus],
        statusReason: fallbackStatus === 'pending'
          ? '重新入社请求已收到，但成员状态暂时无法同步。请刷新状态确认，不要重复提交。'
          : '提交结果可能已经处理成功，但当前无法确认成员状态。请刷新状态确认；不要重复提交邀请码。',
      });
      return fallbackStatus;
    } finally {
      this.setData({ submitting: false });
    }
  },

  onRefreshStatus() {
    if (this.data.submitting) return;
    if (this.data.status === 'uncertain') return this.reconcileJoinOutcome();
    this.loadPage();
  },

  onPendingReapply() {
    if (this.data.submitting) return;
    this.setData({ showPendingReapplyForm: true });
  },

  onReturnOrigin() {
    const target = ORIGIN_TABS[this.data.from];
    if (target) {
      wx.switchTab({ url: target });
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  onContact() {
    wx.showModal({
      title: '联系社团管理员',
      content: '请通过社团已有的线下或群内渠道联系管理员。小程序不会收集你的手机号或其他联系方式。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onClubTap() {
    navigateTo('/pages/community/club/index');
  },
});
