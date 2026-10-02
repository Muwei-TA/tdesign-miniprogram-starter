import { fetchUsageStatus } from './usage';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const USAGE_ALERT_LABELS = {
  ok: '正常',
  near_limit: '接近限额',
  limit_reached: '已达限额',
  disabled: '未配置 / 已关闭',
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

function requiredCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`用量状态字段无效：${field}`);
  return value;
}

function requiredRatio(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`用量状态字段无效：${field}`);
  }
  return value;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function normalizeUsageStatus(status) {
  if (!status || typeof status !== 'object') throw new Error('用量状态暂时无法读取');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(status.date || '') || status.timezone !== 'UTC' || !status.updatedAt) {
    throw new Error('用量状态缺少 UTC 统计窗口信息');
  }

  const normalizeAlert = (value, field) => {
    if (!Object.prototype.hasOwnProperty.call(USAGE_ALERT_LABELS, value)) {
      throw new Error(`用量状态字段无效：${field}`);
    }
    return { state: value, label: USAGE_ALERT_LABELS[value], disabled: value === 'disabled' };
  };

  const uploadAlert = normalizeAlert(status.upload && status.upload.alertState, 'upload.alertState');
  const reviewAlert = normalizeAlert(status.review && status.review.alertState, 'review.alertState');
  const upload = status.upload || {};
  const review = status.review || {};
  const uploadUsedBytes = requiredCount(upload.usedBytes, 'upload.usedBytes');
  const uploadReservedBytes = requiredCount(upload.reservedBytes, 'upload.reservedBytes');
  const uploadLimitBytes = requiredCount(upload.dailyLimitBytes, 'upload.dailyLimitBytes');
  const uploadRemainingBytes = requiredCount(upload.remainingBytes, 'upload.remainingBytes');
  const userUploadLimitBytes = requiredCount(upload.userDailyLimitBytes, 'upload.userDailyLimitBytes');
  const uploadWarningRatio = requiredRatio(upload.warningRatio, 'upload.warningRatio');
  const reviewCalls = requiredCount(review.calls, 'review.calls');
  const reviewTextCalls = requiredCount(review.textCalls, 'review.textCalls');
  const reviewImageCalls = requiredCount(review.imageCalls, 'review.imageCalls');
  const reviewLimitCalls = requiredCount(review.dailyLimitCalls, 'review.dailyLimitCalls');
  const reviewRemainingCalls = requiredCount(review.remainingCalls, 'review.remainingCalls');
  const reviewWarningRatio = requiredRatio(review.warningRatio, 'review.warningRatio');

  if ((uploadAlert.disabled && uploadLimitBytes !== 0) || (!uploadAlert.disabled && uploadLimitBytes === 0)) {
    throw new Error('上传限额与护栏状态不一致');
  }
  if ((reviewAlert.disabled && reviewLimitCalls !== 0) || (!reviewAlert.disabled && reviewLimitCalls === 0)) {
    throw new Error('审核限额与护栏状态不一致');
  }

  return {
    date: status.date,
    timezone: status.timezone,
    updatedAt: status.updatedAt,
    upload: {
      ...uploadAlert,
      usedText: formatBytes(uploadUsedBytes),
      reservedText: formatBytes(uploadReservedBytes),
      limitText: uploadLimitBytes ? formatBytes(uploadLimitBytes) : '',
      remainingText: formatBytes(uploadRemainingBytes),
      userLimitText: userUploadLimitBytes ? formatBytes(userUploadLimitBytes) : '',
      userLimitDisabled: userUploadLimitBytes === 0,
      warningText: `${Math.round(uploadWarningRatio * 100)}%`,
    },
    review: {
      ...reviewAlert,
      calls: reviewCalls,
      textCalls: reviewTextCalls,
      imageCalls: reviewImageCalls,
      limitCalls: reviewLimitCalls,
      remainingCalls: reviewRemainingCalls,
      warningText: `${Math.round(reviewWarningRatio * 100)}%`,
      alertedAt: review.alertedAt || '',
    },
  };
}

Page({
  data: {
    session: null,
    accessState: 'checking',
    usageStatus: null,
    usageLoading: false,
    usageErrorText: '',
  },

  onLoad() {
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    this.usageRequestId = (this.usageRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onPullDownRefresh() {
    this.loadUsageStatus().finally(() => wx.stopPullDownRefresh());
  },

  applySession(session) {
    if (!session) return;
    const changed = this.sessionScope !== sessionScope(session);
    this.sessionScope = sessionScope(session);
    if (changed) {
      this.usageRequestId = (this.usageRequestId || 0) + 1;
      this.setData({ usageStatus: null, usageLoading: false, usageErrorText: '' });
    }
    if (!canAccess(session)) {
      this.usageRequestId = (this.usageRequestId || 0) + 1;
      this.setData({
        session,
        accessState: 'denied',
        usageStatus: null,
        usageLoading: false,
        usageErrorText: '',
      });
      return;
    }

    const shouldLoad = changed || this.data.accessState !== 'allowed';
    this.setData({ session, accessState: 'allowed' }, () => {
      if (shouldLoad) this.loadUsageStatus();
    });
  },

  async loadUsageStatus() {
    if (this.data.accessState !== 'allowed' || !canAccess(this.data.session)) return;
    const requestId = (this.usageRequestId || 0) + 1;
    this.usageRequestId = requestId;
    this.setData({ usageLoading: true, usageErrorText: '' });
    try {
      const status = normalizeUsageStatus(await fetchUsageStatus());
      if (requestId !== this.usageRequestId) return;
      this.setData({ usageStatus: status, usageLoading: false, usageErrorText: '' });
    } catch (err) {
      if (requestId !== this.usageRequestId) return;
      this.setData({ usageLoading: false, usageErrorText: err.message || '用量状态暂时无法读取' });
    }
  },

  onUsageRefresh() {
    return this.loadUsageStatus();
  },

  onReviewsPage() {
    navigateTo('/pages/admin/reviews/index');
  },

  onMembersPage() {
    navigateTo('/pages/admin/members/index');
  },

  onAppealsPage() {
    navigateTo('/pages/admin/appeals/index');
  },
});
