import Page from '~/utils/themed-page';
import { fetchInitialSession } from '~/services/session';
import {
  acceptHandover,
  acceptRecovery,
  declineHandover,
  declineRecovery,
  fetchAccountHandovers,
  fetchAccountRecoveries,
  fetchAccountRecovery,
} from '../governance';

const INBOX_PAGE_LIMIT = 50;
const INBOX_MAX_PAGES = 50;

function isPending(item, kind) {
  return kind === 'handover'
    ? item.status === 'proposed'
    : item.status === 'recovery_requested' && !item.acceptedAt;
}

function decorate(item) {
  return {
    ...item,
    expiresAtText: item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '未提供',
    acceptedAtText: item.acceptedAt ? new Date(item.acceptedAt).toLocaleString() : '',
    memberSummary: (item.proposedTeam || []).map((member) => `${member.displayName} · ${member.role === 'moderator' ? '负责人' : '审核管理员'}`).join('、'),
  };
}

async function fetchAllInboxPages(fetchPage, isCurrent) {
  const items = [];
  const seenCursors = new Set();
  let cursor = '';
  for (let page = 0; page < INBOX_MAX_PAGES; page += 1) {
    if (!isCurrent()) return { items, complete: false, stale: true };
    // Sequential reads keep each nextCursor bound to the previous response.
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchPage({ limit: INBOX_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    if (!isCurrent()) return { items, complete: false, stale: true };
    if (!result) throw new Error('管理确认事项分页响应不完整。');
    const { items: pageItems, nextCursor } = result;
    if (!Array.isArray(pageItems)) throw new Error('管理确认事项分页响应不完整。');
    items.push(...pageItems);
    if (nextCursor === undefined || nextCursor === null || nextCursor === '') return { items, complete: true, stale: false };
    if (typeof nextCursor !== 'string') throw new Error('管理确认事项分页游标无效，请刷新后重试。');
    if (seenCursors.has(nextCursor)) throw new Error('管理确认事项分页游标异常，请刷新后重试。');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error('管理确认事项超过可读取页数，请刷新后重试。');
}

Page({
  data: {
    identity: '',
    loading: true,
    busyId: '',
    handovers: [],
    recoveries: [],
    focusId: '',
    focusKind: '',
    errorText: '',
    reasonVisible: false,
    reason: '',
    pendingDecision: null,
  },

  onLoad(options) {
    this.focusId = options.handoverId || options.recoveryId || '';
    this.focusKind = '';
    if (options.handoverId) this.focusKind = 'handover';
    else if (options.recoveryId) this.focusKind = 'recovery';
    this.inboxRequestId = 0;
    this.identityUserId = '';
    this.hasShownOnce = false;
    return this.load();
  },

  onShow() {
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    this.load();
  },

  onUnload() {
    this.inboxRequestId += 1;
  },

  async load() {
    const requestId = this.inboxRequestId + 1;
    this.inboxRequestId = requestId;
    this.setData({
      identity: '', handovers: [], recoveries: [], loading: true, errorText: '', busyId: '',
      reasonVisible: false, reason: '', pendingDecision: null,
    });
    try {
      const session = await fetchInitialSession();
      if (requestId !== this.inboxRequestId) return;
      const userId = session && session.user && session.user.id;
      if (!userId) throw new Error('请先完成小程序账号登录。');
      this.identityUserId = userId;
      const isCurrent = () => requestId === this.inboxRequestId;
      const [handoverResult, recoveryResult] = await Promise.all([
        fetchAllInboxPages(fetchAccountHandovers, isCurrent),
        fetchAllInboxPages(fetchAccountRecoveries, isCurrent),
      ]);
      if (requestId !== this.inboxRequestId) return;
      if (!handoverResult.complete || !recoveryResult.complete) {
        if (handoverResult.stale || recoveryResult.stale) return;
        throw new Error('管理确认事项尚未完整读取，请刷新后重试。');
      }
      if (!await this.confirmIdentity(requestId, userId)) return;
      let handovers = (handoverResult.items || []).filter((item) => item.targetUserId === userId).map(decorate);
      let recoveries = (recoveryResult.items || []).map(decorate);

      if (this.focusKind === 'handover') handovers = handovers.filter((item) => item.id === this.focusId);
      if (this.focusKind === 'recovery') {
        recoveries = recoveries.filter((item) => item.id === this.focusId);
        if (!recoveries.length && this.focusId) {
          const item = await fetchAccountRecovery(this.focusId);
          if (requestId !== this.inboxRequestId) return;
          if (!await this.confirmIdentity(requestId, userId)) return;
          if (item && item.id === this.focusId) recoveries = [decorate(item)];
        }
      }

      const focusedItems = this.focusKind === 'handover' ? handovers : recoveries;
      const focusMissing = !!this.focusId && !focusedItems.some((item) => item.id === this.focusId);

      this.setData({
        identity: session.user.displayName || userId,
        handovers,
        recoveries,
        focusId: this.focusId,
        focusKind: this.focusKind,
        loading: false,
        errorText: focusMissing ? '这项确认已完成、过期或当前账号无权处理。' : '',
      });
    } catch (err) {
      if (requestId !== this.inboxRequestId) return;
      this.setData({ loading: false, errorText: err.message || '管理确认事项暂时无法读取。' });
    }
  },

  async confirmIdentity(requestId, expectedUserId) {
    let session;
    try {
      session = await fetchInitialSession();
    } catch (err) {
      if (requestId !== this.inboxRequestId) return false;
      this.inboxRequestId += 1;
      this.identityUserId = '';
      this.setData({
        identity: '', handovers: [], recoveries: [], loading: false, busyId: '',
        reasonVisible: false, reason: '', pendingDecision: null,
        errorText: '暂时无法确认当前小程序账号，请刷新后重新读取。',
      });
      return false;
    }
    if (requestId !== this.inboxRequestId) return false;
    const currentUserId = session && session.user && session.user.id;
    if (currentUserId !== expectedUserId) {
      this.inboxRequestId += 1;
      this.identityUserId = '';
      this.setData({
        identity: '', handovers: [], recoveries: [], loading: false, busyId: '',
        reasonVisible: false, reason: '', pendingDecision: null,
        errorText: '当前小程序账号已切换，请刷新后重新读取确认事项。',
      });
      return false;
    }
    return true;
  },

  onRetry() {
    this.load();
  },

  onAcceptTap(event) {
    const { kind, id } = event.currentTarget.dataset;
    const item = (kind === 'handover' ? this.data.handovers : this.data.recoveries).find((row) => row.id === id);
    if (!item || !isPending(item, kind) || this.data.busyId) return;
    wx.showModal({
      title: kind === 'handover' ? '接受社团换届' : '接受负责人恢复安排',
      content: kind === 'recovery'
        ? `${item.clubName} · 有效至 ${item.expiresAtText}。恢复完成后仅目标账号保留管理权限，现有其他管理员降为普通成员。`
        : `${item.clubName} · 有效至 ${item.expiresAtText}。确认后会更新新一届管理权限并记录审计。`,
      confirmText: '确认接受',
      confirmColor: '#315948',
      success: (result) => {
        if (result.confirm) this.submitDecision(kind, item, 'accept');
      },
    });
  },

  onDeclineTap(event) {
    const { kind, id } = event.currentTarget.dataset;
    const item = (kind === 'handover' ? this.data.handovers : this.data.recoveries).find((row) => row.id === id);
    if (!item || !isPending(item, kind) || this.data.busyId) return;
    this.setData({
      reasonVisible: true,
      reason: '',
      pendingDecision: { kind, id, clubId: item.clubId, version: item.version },
    });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  onStopPropagation() {},

  onReasonCancel() {
    if (this.data.busyId) return;
    this.setData({ reasonVisible: false, reason: '', pendingDecision: null });
  },

  onReasonSubmit() {
    const reason = String(this.data.reason || '').trim();
    const pending = this.data.pendingDecision;
    if (!pending || !reason) {
      wx.showToast({ title: '请填写拒绝理由', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '拒绝这项安排',
      content: '拒绝原因会写入管理审计。确认继续？',
      confirmText: '确认拒绝',
      confirmColor: '#a85648',
      success: (result) => {
        if (result.confirm) this.submitDecision(pending.kind, {
          id: pending.id,
          clubId: pending.clubId,
          version: pending.version,
        }, 'decline', reason);
        else this.onReasonCancel();
      },
    });
  },

  async submitDecision(kind, item, decision, reason = '') {
    if (this.data.busyId) return;
    const requestId = this.inboxRequestId;
    const actorUserId = this.identityUserId;
    if (!actorUserId) return;
    const version = item.expectedVersion !== undefined && item.expectedVersion !== null
      ? item.expectedVersion
      : item.version;
    this.setData({ busyId: item.id, reasonVisible: false, errorText: '' });
    try {
      if (!await this.confirmIdentity(requestId, actorUserId)) return;
      if (kind === 'handover' && decision === 'accept') {
        await acceptHandover(item.id, version, item.clubId);
      } else if (kind === 'handover') {
        await declineHandover(item.id, version, reason, item.clubId);
      } else if (decision === 'accept') {
        await acceptRecovery(item.id, version, item.clubId);
      } else {
        await declineRecovery(item.id, version, reason, item.clubId);
      }
      if (!await this.confirmIdentity(requestId, actorUserId)) return;
      this.setData({ busyId: '', pendingDecision: null, reason: '' });
      wx.showToast({ title: decision === 'accept' ? '已确认' : '已拒绝', icon: 'success' });
      await this.load();
    } catch (err) {
      if (requestId !== this.inboxRequestId) return;
      this.setData({ busyId: '', pendingDecision: null, reason: '' });
      if (err.kind === 'conflict') {
        this.setData({ errorText: '这项安排已发生变化，正在重新读取状态。' });
        await this.load();
      } else {
        this.setData({ errorText: err.message || '操作未完成，请刷新后重试。' });
      }
    }
  },
});
