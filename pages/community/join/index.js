import {
  fetchMembershipSession,
  fetchMyMembershipApplication,
  submitMembershipApplication,
} from '../membership';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const DEFAULT_RULES_VERSION = 'v1.1';
const MAX_DISPLAY_NAME_LENGTH = 20;

const STATUS_META = {
  idle: {
    label: '还没有提交申请',
    desc: '填写昵称和邀请码，读完社区约定后再提交。',
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
    desc: '我们不会重复创建申请。可以刷新状态，或联系社团管理员。',
    icon: 'info-circle',
    tone: 'notice',
  },
  pending: {
    label: '申请已收到，等待管理员确认',
    desc: '管理员确认后，成员资格会在下一次会话刷新时生效。',
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
  return 'idle';
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
  },

  onLoad(options) {
    this.setData({ from: options.from || '' });
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    this.loadPage();
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  async loadPage() {
    this.setData({ loading: true, loadError: '' });
    try {
      const snapshot = await fetchMembershipSession();
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
    const club = session.club || this.data.club;
    const nextStatus = normalizeStatus(session.memberStatus);
    this.setData({
      session,
      club,
      status: nextStatus,
      statusMeta: STATUS_META[nextStatus] || STATUS_META.idle,
      rulesVersion: (club && club.rulesVersion) || this.data.rulesVersion,
    });
  },

  async loadApplication() {
    try {
      const application = await fetchMyMembershipApplication();
      if (!application) return;
      const status = normalizeStatus(application.state);
      this.setData({
        status,
        statusMeta: STATUS_META[status] || STATUS_META.idle,
        statusReason: application.reason || '',
        appliedAtText: application.appliedAtText || '',
      });
    } catch (err) {
      // 访客可能还没有可查询的账号；此时仍允许阅读介绍并开始授权流程。
      if (err && err.kind !== 'unauthenticated') {
        this.setData({ statusReason: errorTextForLoad(err) });
      }
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
    const session = await fetchMembershipSession();
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
    try {
      const session = await this.ensureSession();
      if (!session || !session.user) {
        throw new Error('会话还没有准备好，请稍后重试。');
      }

      const result = await submitMembershipApplication({
        ...form,
        rulesVersion: this.data.rulesVersion,
      });
      const status = normalizeStatus(result && result.state);
      if (!result || !result.state || !STATUS_META[status] || status === 'idle') {
        throw new Error('申请状态暂时无法确认，请稍后在本页重试。');
      }
      this.setData({
        submitting: false,
        status,
        statusMeta: STATUS_META[status],
        statusReason: result.reason || '',
        appliedAtText: result.appliedAtText || '刚刚提交',
      });
      if (status === 'pending') {
        wx.showToast({ title: '已提交，等待确认', icon: 'none' });
      }
    } catch (err) {
      const status = statusForSubmitError(err);
      this.setData({
        submitting: false,
        status,
        statusMeta: STATUS_META[status],
        statusReason:
          status === 'idle' ? (err && err.message) || '申请没有提交，请稍后重试。' : (err && err.message) || '',
      });
    }
  },

  onRefreshStatus() {
    this.loadPage();
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
