import {
  fetchMembers,
  removeMember,
  muteMember,
  changeMemberRole,
  createInvite,
} from '../governance';

const app = getApp();
const DAY_SECONDS = 24 * 60 * 60;

function canAccess(session) {
  return !!session && session.memberStatus === 'active' && session.role === 'moderator';
}

function currentUserId(session) {
  return session && session.user && session.user.id;
}

function formatMutedUntil(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `禁言至 ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function decorateMember(item, currentId) {
  return {
    ...item,
    mutedUntilText: formatMutedUntil(item.mutedUntil),
    isSelf: !!currentId && item.targetUserId === currentId,
  };
}

Page({
  data: {
    session: null,
    accessState: 'checking',
    members: [],
    loading: false,
    errorText: '',
    reasonSheetVisible: false,
    pendingAction: null,
    reason: '',
    actionBusy: false,
    inviteMaxUses: '1',
    inviteTtlDays: '7',
    inviteBusy: false,
    inviteCode: '',
    inviteExpiresAt: '',
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
    if (this.data.accessState === 'allowed') this.loadMembers({ silent: true });
  },

  onPullDownRefresh() {
    this.loadMembers().finally(() => wx.stopPullDownRefresh());
  },

  applySession(session) {
    if (!session) return;
    if (!canAccess(session)) {
      this.setData({ session, accessState: 'denied', members: [], loading: false });
      return;
    }
    const firstLoad = this.data.accessState !== 'allowed';
    this.setData({ session, accessState: 'allowed' }, () => {
      if (firstLoad) this.loadMembers();
    });
  },

  async loadMembers({ silent = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    this.setData({ loading: true, ...(silent ? {} : { errorText: '' }) });
    try {
      const result = await fetchMembers({ limit: 100 });
      const userId = currentUserId(this.data.session);
      this.setData({
        members: (result.items || []).map((item) => decorateMember(item, userId)),
        loading: false,
        errorText: '',
      });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '成员名册暂时无法读取。' });
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', members: [] });
      }
    }
  },

  onRetry() {
    this.loadMembers();
  },

  onActionTap(e) {
    if (this.data.actionBusy) return;
    const { id, key } = e.currentTarget.dataset;
    const member = this.data.members.find((item) => item.targetUserId === id);
    if (!member || member.isSelf || member.status !== 'active') return;
    this.setData({
      pendingAction: { key, targetUserId: id, displayName: member.displayName },
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
      wx.showToast({ title: '请填写处理理由', icon: 'none' });
      return;
    }
    if (reason.length > 500) {
      wx.showToast({ title: '处理理由最多 500 字', icon: 'none' });
      return;
    }
    const pending = this.data.pendingAction;
    if (!pending) return;
    this.setData({ actionBusy: true, reasonSheetVisible: false });
    wx.showModal({
      title: '确认成员操作',
      content: `将对「${pending.displayName}」执行操作，理由会写入审计记录。`,
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) this.executeAction(pending, reason);
        else this.resetAction();
      },
      fail: () => this.resetAction(),
    });
  },

  async executeAction(pending, reason) {
    const member = this.data.members.find((item) => item.targetUserId === pending.targetUserId);
    if (!member || member.isSelf) {
      this.resetAction();
      return;
    }
    try {
      if (pending.key === 'remove') {
        await removeMember(member.targetUserId, member.version, reason);
      } else if (pending.key === 'mute') {
        await muteMember(member.targetUserId, member.version, new Date(Date.now() + DAY_SECONDS * 1000).toISOString(), reason);
      } else if (pending.key === 'unmute') {
        await muteMember(member.targetUserId, member.version, null, reason);
      } else {
        const role = pending.key === 'promote' ? 'moderator' : 'member';
        await changeMemberRole(member.targetUserId, member.version, role, reason);
      }
      wx.showToast({ title: '成员状态已更新', icon: 'none' });
      this.resetAction();
      this.loadMembers({ silent: true });
    } catch (err) {
      this.resetAction();
      if (err.kind === 'conflict') {
        wx.showToast({ title: '成员状态已变化，请刷新', icon: 'none' });
        this.loadMembers();
      } else {
        wx.showToast({ title: err.message || '成员操作未完成', icon: 'none' });
      }
    }
  },

  resetAction() {
    this.setData({ actionBusy: false, reasonSheetVisible: false, pendingAction: null, reason: '' });
  },

  onInviteMaxUsesInput(e) {
    this.setData({ inviteMaxUses: e.detail.value });
  },

  onInviteTtlDaysInput(e) {
    this.setData({ inviteTtlDays: e.detail.value });
  },

  async onCreateInvite() {
    if (this.data.inviteBusy) return;
    const maxUses = Number(this.data.inviteMaxUses);
    const ttlDays = Number(this.data.inviteTtlDays);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) {
      wx.showToast({ title: '使用次数需为 1 至 1000', icon: 'none' });
      return;
    }
    if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 90) {
      wx.showToast({ title: '有效期需为 1 至 90 天', icon: 'none' });
      return;
    }
    this.setData({ inviteBusy: true });
    try {
      const result = await createInvite({ maxUses, ttlSeconds: ttlDays * DAY_SECONDS });
      this.setData({ inviteBusy: false, inviteCode: result.code || '', inviteExpiresAt: result.expiresAt || '' });
      wx.showModal({
        title: '邀请码已生成',
        content: `${result.code}\n${result.maxUses || maxUses} 次使用 · 有效期至 ${result.expiresAt || '服务端时间'}`,
        confirmText: '复制邀请码',
        cancelText: '知道了',
        success: (res) => {
          if (res.confirm && result.code) this.copyInviteCode();
        },
      });
    } catch (err) {
      this.setData({ inviteBusy: false });
      wx.showToast({ title: err.message || '邀请码暂时无法生成', icon: 'none' });
    }
  },

  copyInviteCode() {
    if (!this.data.inviteCode) return;
    wx.setClipboardData({ data: this.data.inviteCode });
  },
});
