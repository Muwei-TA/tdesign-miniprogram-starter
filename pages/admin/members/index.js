import Page from '~/utils/themed-page';
import {
  fetchMembers,
  removeMember,
  muteMember,
  changeMemberRole,
  createInvite,
  fetchInvites,
  revokeInvite,
} from '../governance';

const app = getApp();
const DAY_SECONDS = 24 * 60 * 60;

function canAccess(session) {
  return !!session && !!session.club && session.memberStatus === 'active' && session.role === 'moderator';
}

function sessionScope(session) {
  return session ? [session.user && session.user.id, session.club && session.club.id, session.role, session.memberStatus].join(':') : '';
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
    memberStatus: 'all',
    membersCursor: '',
    membersHasMore: false,
    loading: false,
    errorText: '',
    reasonSheetVisible: false,
    pendingAction: null,
    reason: '',
    actionBusy: false,
    inviteMaxUses: '1',
    inviteTtlDays: '7',
    inviteMode: 'application',
    inviteTargetUserId: '',
    inviteReason: '',
    inviteBusy: false,
    inviteCode: '',
    inviteExpiresAt: '',
    invites: [],
    inviteStatus: 'all',
    invitesCursor: '',
    invitesHasMore: false,
    invitesLoading: false,
    invitesErrorText: '',
  },

  onLoad() {
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (app.globalData.session) this.applySession(app.globalData.session);
  },

  onUnload() {
    this.membersRequestId = (this.membersRequestId || 0) + 1;
    this.invitesRequestId = (this.invitesRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onHide() {
    this.setData({ inviteCode: '', inviteExpiresAt: '' });
  },

  onShow() {
    if (this.data.accessState === 'allowed') {
      this.loadMembers({ silent: true });
      this.loadInvites({ silent: true });
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadMembers(), this.loadInvites()]).finally(() => wx.stopPullDownRefresh());
  },

  applySession(session) {
    if (!session) return;
    const changed = this.sessionScope !== sessionScope(session);
    this.sessionScope = sessionScope(session);
    if (changed) {
      this.membersRequestId = (this.membersRequestId || 0) + 1;
      this.invitesRequestId = (this.invitesRequestId || 0) + 1;
      this.setData({
        members: [], membersCursor: '', membersHasMore: false, loading: false, errorText: '',
        reasonSheetVisible: false, pendingAction: null, inviteCode: '', inviteExpiresAt: '',
        invites: [], invitesCursor: '', invitesHasMore: false, invitesLoading: false, invitesErrorText: '',
      });
    }
    if (!canAccess(session)) {
      this.setData({ session, accessState: 'denied', members: [], invites: [], loading: false, invitesLoading: false });
      return;
    }
    const firstLoad = changed || this.data.accessState !== 'allowed';
    this.setData({ session, accessState: 'allowed' }, () => {
      if (firstLoad) {
        this.loadMembers();
        this.loadInvites();
      }
    });
  },

  async loadMembers({ silent = false, append = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    if (append && !this.data.membersHasMore) return;
    const requestId = (this.membersRequestId || 0) + 1;
    this.membersRequestId = requestId;
    this.setData({ loading: true, ...(silent ? {} : { errorText: '' }) });
    try {
      const result = await fetchMembers({
        limit: 50,
        cursor: append ? this.data.membersCursor : '',
        status: this.data.memberStatus === 'all' ? '' : this.data.memberStatus,
      });
      if (requestId !== this.membersRequestId) return;
      const userId = currentUserId(this.data.session);
      const nextItems = (result.items || []).map((item) => decorateMember(item, userId));
      this.setData({
        members: append ? this.data.members.concat(nextItems) : nextItems,
        membersCursor: result.nextCursor || '',
        membersHasMore: !!result.nextCursor,
        loading: false,
        errorText: '',
      });
    } catch (err) {
      if (requestId !== this.membersRequestId) return;
      this.setData({ loading: false, errorText: err.message || '成员名册暂时无法读取。' });
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', members: [] });
      }
    }
  },

  async loadInvites({ silent = false, append = false } = {}) {
    if (this.data.accessState !== 'allowed') return;
    if (append && !this.data.invitesHasMore) return;
    const requestId = (this.invitesRequestId || 0) + 1;
    this.invitesRequestId = requestId;
    this.setData({ invitesLoading: true, ...(silent ? {} : { invitesErrorText: '' }) });
    try {
      const result = await fetchInvites({
        limit: 30,
        cursor: append ? this.data.invitesCursor : '',
        status: this.data.inviteStatus === 'all' ? '' : this.data.inviteStatus,
      });
      if (requestId !== this.invitesRequestId) return;
      const items = result.items || [];
      this.setData({
        invites: append ? this.data.invites.concat(items) : items,
        invitesCursor: result.nextCursor || '',
        invitesHasMore: !!result.nextCursor,
        invitesLoading: false,
        invitesErrorText: '',
      });
    } catch (err) {
      if (requestId !== this.invitesRequestId) return;
      this.setData({ invitesLoading: false, invitesErrorText: err.message || '邀请码列表暂时无法读取。' });
      if (err.kind === 'forbidden' || err.kind === 'membership_invalid') {
        this.setData({ accessState: 'denied', members: [], invites: [] });
      }
    }
  },

  onRetry() {
    this.loadMembers();
    this.loadInvites();
  },

  onMemberStatusTap(event) {
    const status = event.currentTarget.dataset.status || 'all';
    if (status === this.data.memberStatus) return;
    this.setData({ memberStatus: status, members: [], membersCursor: '', membersHasMore: false }, () => this.loadMembers());
  },

  onInviteStatusTap(event) {
    const status = event.currentTarget.dataset.status || 'all';
    if (status === this.data.inviteStatus) return;
    this.setData({ inviteStatus: status, invites: [], invitesCursor: '', invitesHasMore: false }, () => this.loadInvites());
  },

  onLoadMoreMembers() {
    this.loadMembers({ append: true });
  },

  onLoadMoreInvites() {
    this.loadInvites({ append: true });
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
    if (pending.inviteId) {
      this.setData({ actionBusy: true, reasonSheetVisible: false });
      wx.showModal({
        title: '撤销邀请码',
        content: '撤销会立即阻止后续兑换，已提交且仍在预留期内的申请继续由管理团队处理。',
        confirmText: '确认撤销',
        confirmColor: '#a85648',
        success: (res) => {
          if (res.confirm) this.executeInviteRevoke(pending, reason);
          else this.resetAction();
        },
        fail: () => this.resetAction(),
      });
      return;
    }
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

  onInviteRevokeTap(event) {
    if (this.data.actionBusy) return;
    const invite = this.data.invites.find((item) => item.inviteId === event.currentTarget.dataset.id);
    if (!invite || invite.status !== 'active') return;
    this.setData({
      pendingAction: { inviteId: invite.inviteId, version: invite.version, displayName: invite.modeText },
      reason: '',
      reasonSheetVisible: true,
    });
  },

  async executeInviteRevoke(pending, reason) {
    try {
      await revokeInvite(pending.inviteId, pending.version, reason);
      this.resetAction();
      wx.showToast({ title: '邀请码已撤销', icon: 'success' });
      this.loadInvites();
    } catch (err) {
      this.resetAction();
      if (err.kind === 'conflict') {
        wx.showToast({ title: '邀请码状态已变化，请刷新', icon: 'none' });
        this.loadInvites();
      } else {
        wx.showToast({ title: err.message || '撤销未完成', icon: 'none' });
      }
    }
  },

  onInviteMaxUsesInput(e) {
    this.setData({ inviteMaxUses: e.detail.value });
  },

  onInviteTtlDaysInput(e) {
    this.setData({ inviteTtlDays: e.detail.value });
  },

  onInviteModeChange(e) {
    const mode = e.detail.value;
    if (mode !== 'application' && mode !== 'direct') return;
    this.setData({ inviteMode: mode });
  },

  onInviteTargetInput(e) {
    this.setData({ inviteTargetUserId: e.detail.value });
  },

  onInviteReasonInput(e) {
    this.setData({ inviteReason: e.detail.value });
  },

  async onCreateInvite() {
    if (this.data.inviteBusy) return;
    const maxUses = this.data.inviteMode === 'direct' ? 1 : Number(this.data.inviteMaxUses);
    const ttlDays = Number(this.data.inviteTtlDays);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) {
      wx.showToast({ title: '使用次数需为 1 至 1000', icon: 'none' });
      return;
    }
    if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 90) {
      wx.showToast({ title: '有效期需为 1 至 90 天', icon: 'none' });
      return;
    }
    const reason = String(this.data.inviteReason || '').trim();
    if (reason.length < 10 || reason.length > 500) {
      wx.showToast({ title: '请填写 10 至 500 字的创建理由', icon: 'none' });
      return;
    }
    const targetUserId = String(this.data.inviteTargetUserId || '').trim();
    if (this.data.inviteMode === 'direct' && !targetUserId) {
      wx.showToast({ title: '定向直邀需要填写目标账号 ID', icon: 'none' });
      return;
    }
    this.setData({ inviteBusy: true });
    try {
      const result = await createInvite({
        mode: this.data.inviteMode,
        maxUses,
        ttlSeconds: ttlDays * DAY_SECONDS,
        targetUserId: this.data.inviteMode === 'direct' ? targetUserId : undefined,
        reason,
      });
      if (!result || !result.inviteId || !result.code || result.inviteId === this.displayedInviteId) {
        throw new Error('邀请码已创建，但原码不会再次显示。请立即在创建结果中保存；若没有结果，请重新创建新码。');
      }
      this.displayedInviteId = result.inviteId;
      this.setData({ inviteBusy: false, inviteCode: result.code, inviteExpiresAt: result.expiresAt || '' });
      wx.showModal({
        title: '邀请码已生成',
        content: `${this.data.inviteMode === 'direct' ? '仅绑定账号可领取，领取后直接成为普通成员。' : '公开申请码，提交后进入人工审核。'}\n${result.maxUses || maxUses} 次 · 有效期至 ${result.expiresAt || '服务端时间'}。原码只显示在本页一次。`,
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
