// app.js
import config from './config';
import createBus from './utils/eventBus';
import { fetchUnreadCount } from './services/notifications';
import {
  bootstrapSession,
  refreshSessionFromServer,
  refreshSessionForClub,
  setCurrentSession,
  setSessionWithoutClub,
  clearAccountScope,
} from './services/session';
import { fetchMyClubs } from './services/clubs';

App({
  globalData: {
    /** 会话与成员状态，唯一来源是 services/session.js */
    session: null,
    clubMemberships: [],
    clubContextVersion: 0,
    clubSwitching: false,
    needsClubSelection: false,
    /** 站内未读通知数（消息入口在树洞首页顶部） */
    unreadCount: 0,
  },

  /** 全局事件总线，事件契约见 docs/03-routing-and-navigation.md 3.5 */
  eventBus: createBus(),

  onLaunch(options) {
    this.captureClubLink(options);
    this.initCloudBase();
    this.checkUpdate();
    this.sessionInitialization = this.initSession();
  },

  onHide() {
    this.wasHidden = true;
  },

  onShow(options) {
    const hasClubLink = this.captureClubLink(options);
    if (hasClubLink && this.sessionInitialized) this.handleIncomingClubLink();
    // 冷启动时仍由 initSession 在会话恢复后拉取；这里只刷新后台返回后的未读数。
    if (!this.wasHidden) return;
    this.wasHidden = false;
    const { session } = this.globalData;
    if (!session || session.memberStatus !== 'active' || !session.club) return;
    return this.refreshUnreadCount();
  },

  /** CloudBase profile 需要初始化 SDK；NAS HTTP profile 不调用 CloudBase API。 */
  initCloudBase() {
    if (config.transport !== 'cloudbase') return;
    if (!wx.cloud || typeof wx.cloud.init !== 'function') return;
    wx.cloud.init({
      env: config.env,
      traceUser: config.traceUser,
    });
  },

  checkUpdate() {
    if (!wx.getUpdateManager) return;
    const updateManager = wx.getUpdateManager();
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        success(res) {
          if (res.confirm) updateManager.applyUpdate();
        },
      });
    });
  },

  captureClubLink(options) {
    const query = options && options.query;
    const clubId = (query && query.clubId) || (options && options.clubId);
    if (typeof clubId !== 'string' || !clubId) return false;
    const postId = query && query.id;
    this.globalData.pendingClubLink = { clubId, postId: postId || '' };
    this.pendingClubLinkKey = `${clubId}:${postId || ''}`;
    return true;
  },

  /** 冷启动恢复账号后先解析社团选择，不采用 session/me 的默认社团。 */
  async initSession() {
    const baseSession = await bootstrapSession();
    let memberships = [];
    let membershipLoadError = false;
    if (baseSession.user) {
      try {
        memberships = await fetchMyClubs();
      } catch (err) {
        membershipLoadError = true;
      }
    }
    const valid = memberships.filter((club) => club
      && club.status === 'active'
      && club.memberStatus === 'active'
      && typeof club.id === 'string'
      && club.id);
    this.globalData.clubMemberships = valid;
    const userId = baseSession.user && baseSession.user.id;
    const savedClubId = userId ? wx.getStorageSync(`hg:${userId}:selected-club`) : '';
    const incomingId = this.globalData.pendingClubLink && this.globalData.pendingClubLink.clubId;
    const incomingMembership = valid.find((club) => club.id === incomingId);
    const savedMembership = valid.find((club) => club.id === savedClubId);
    let selected = '';
    if (incomingMembership) selected = incomingMembership.id;
    else if (savedMembership) selected = savedMembership.id;
    else if (valid.length === 1) selected = valid[0].id;

    if (selected) {
      try {
        const session = await refreshSessionForClub(selected);
        if (!session || session.memberStatus !== 'active' || !session.club || session.club.id !== selected) {
          throw new Error('社团成员资格已变化');
        }
        if (userId) wx.setStorageSync(`hg:${userId}:selected-club`, selected);
        this.globalData.needsClubSelection = false;
        this.publishSession(session);
      } catch (err) {
        if (userId) wx.removeStorageSync(`hg:${userId}:selected-club`);
        this.globalData.needsClubSelection = true;
        this.publishSession(setSessionWithoutClub(baseSession));
        this.clubSelectionError = err.message || '';
      }
    } else {
      this.globalData.needsClubSelection = true;
      this.publishSession(setSessionWithoutClub(baseSession));
    }

    this.sessionInitialized = true;
    if (this.globalData.needsClubSelection && !incomingId) this.openClubChooser();
    if (membershipLoadError) this.clubSelectionError = '社团列表暂时无法读取，请重试。';
    return this.globalData.session;
  },

  /** 页面重新显示时读取服务端会话，避免沿用已经过期的成员状态。 */
  async refreshSession() {
    const current = this.globalData.session;
    if (!current || !current.club || !current.club.id) {
      const err = new Error('请先选择社团');
      err.kind = 'forbidden';
      err.code = 'club_required';
      throw err;
    }
    try {
      const session = await refreshSessionFromServer();
      if (!session || session.memberStatus !== 'active' || !session.club
        || session.club.id !== current.club.id) {
        this.invalidateClubSelection();
        return this.globalData.session;
      }
      this.publishSession(session);
      return session;
    } catch (err) {
      if (['membership_invalid', 'not_accessible'].includes(err && err.kind)
        && this.globalData.session && this.globalData.session.club
        && this.globalData.session.club.id === current.club.id) {
        this.invalidateClubSelection();
        return this.globalData.session;
      }
      throw err;
    }
  },

  async selectClub(clubId) {
    const memberships = this.globalData.clubMemberships || [];
    const membership = memberships.find((club) => club.id === clubId
      && club.status === 'active'
      && club.memberStatus === 'active');
    if (!membership) return false;
    const previous = this.globalData.session;
    if (previous && previous.club && previous.club.id === clubId) return true;
    if (this.clubSwitchingClubId === clubId && this.clubSwitchPromise) return this.clubSwitchPromise;

    const requestVersion = (this.globalData.clubContextVersion || 0) + 1;
    this.globalData.clubContextVersion = requestVersion;
    this.globalData.clubSwitching = true;
    this.clubSwitchingClubId = clubId;
    this.eventBus.emit('club-context-changing', {
      fromClubId: previous && previous.club && previous.club.id,
      toClubId: clubId,
    });
    const operation = (async () => {
      try {
        const session = await refreshSessionForClub(clubId);
        if (requestVersion !== this.globalData.clubContextVersion) return false;
        if (!session || session.memberStatus !== 'active' || !session.club || session.club.id !== clubId) {
          throw new Error('社团成员资格已变化');
        }
        const userId = session.user && session.user.id;
        if (userId) wx.setStorageSync(`hg:${userId}:selected-club`, clubId);
        this.globalData.clubSwitching = false;
        this.globalData.needsClubSelection = false;
        this.publishSession(session);
        return true;
      } catch (err) {
        if (requestVersion === this.globalData.clubContextVersion) {
          this.globalData.clubSwitching = false;
          this.eventBus.emit('club-switch-failed', { clubId, error: err });
        }
        throw err;
      }
    })();
    this.clubSwitchPromise = operation;
    return operation.finally(() => {
      if (this.clubSwitchPromise !== operation) return;
      this.clubSwitchPromise = null;
      this.clubSwitchingClubId = '';
    });
  },

  async activateJoinedClub(session) {
    if (!session || session.memberStatus !== 'active' || !session.club || !session.club.id) return false;
    const clubId = session.club.id;
    const previous = this.globalData.session;
    this.globalData.clubContextVersion = (this.globalData.clubContextVersion || 0) + 1;
    this.globalData.clubSwitching = true;
    this.eventBus.emit('club-context-changing', {
      fromClubId: previous && previous.club && previous.club.id,
      toClubId: clubId,
    });
    const memberships = this.globalData.clubMemberships || [];
    if (!memberships.some((club) => club.id === clubId)) {
      memberships.push({ ...session.club, status: 'active', role: session.role, memberStatus: 'active' });
    }
    this.globalData.clubMemberships = memberships;
    const userId = session.user && session.user.id;
    if (userId) wx.setStorageSync(`hg:${userId}:selected-club`, clubId);
    this.globalData.clubSwitching = false;
    this.globalData.needsClubSelection = false;
    this.publishSession(session);
    return true;
  },

  async resolveClubLink(clubId) {
    if (this.sessionInitialization && !this.sessionInitialized) await this.sessionInitialization;
    const membership = (this.globalData.clubMemberships || []).find((club) => club.id === clubId
      && club.status === 'active'
      && club.memberStatus === 'active');
    if (!membership) return false;
    if (this.globalData.session && this.globalData.session.club && this.globalData.session.club.id === clubId) return true;
    return this.selectClub(clubId);
  },

  async handleIncomingClubLink() {
    const link = this.globalData.pendingClubLink;
    if (!link) return;
    const key = `${link.clubId}:${link.postId || ''}`;
    if (this.handledClubLinkKey === key) return;
    this.handledClubLinkKey = key;
    try {
      const member = await this.resolveClubLink(link.clubId);
      if (!member) {
        wx.navigateTo({ url: `/pages/community/join/index?clubId=${encodeURIComponent(link.clubId)}&from=share` });
      }
    } catch (err) {
      this.handledClubLinkKey = '';
      wx.showToast({ title: err.message || '社团暂时无法切换', icon: 'none' });
    }
  },

  openClubChooser() {
    if (this.clubChooserOpening) return;
    this.clubChooserOpening = true;
    wx.navigateTo({
      url: '/pages/community/clubs/index',
      complete: () => { this.clubChooserOpening = false; },
    });
  },

  publishSession(session) {
    const { session: previousSession } = this.globalData;
    session = setCurrentSession(session);
    const previousUserId = previousSession && previousSession.user && previousSession.user.id;
    const nextUserId = session && session.user && session.user.id;
    const previousClubId = previousSession && previousSession.club && previousSession.club.id;
    const nextClubId = session && session.club && session.club.id;
    const sessionScopeChanged = !previousSession
      || previousUserId !== nextUserId
      || previousSession.role !== session.role
      || previousSession.memberStatus !== session.memberStatus
      || previousClubId !== nextClubId;
    if (sessionScopeChanged) {
      this.globalData.clubContextVersion = (this.globalData.clubContextVersion || 0) + 1;
      this.invalidateUnreadCountRequests();
    }
    this.globalData.session = session;
    if (sessionScopeChanged && previousSession) {
      this.setUnreadCount(0);
    }
    this.eventBus.emit('session-changed', session);
    if (sessionScopeChanged && session && session.role !== 'guest' && nextUserId) {
      this.refreshUnreadCount();
    }
  },

  invalidateSession() {
    const session = clearAccountScope();
    this.invalidateUnreadCountRequests();
    this.globalData.clubMemberships = [];
    this.globalData.clubContextVersion = (this.globalData.clubContextVersion || 0) + 1;
    this.globalData.clubSwitching = false;
    this.globalData.needsClubSelection = false;
    this.globalData.session = session;
    this.setUnreadCount(0);
    this.eventBus.emit('session-changed', session);
  },

  invalidateClubSelection() {
    const { session } = this.globalData;
    if (!session || !session.club) return;
    this.eventBus.emit('club-context-changing', {
      fromClubId: session.club.id,
      toClubId: '',
    });
    const userId = session.user && session.user.id;
    if (userId) wx.removeStorageSync(`hg:${userId}:selected-club`);
    this.globalData.needsClubSelection = true;
    this.globalData.clubSwitching = false;
    this.globalData.session = setSessionWithoutClub(session);
    this.globalData.clubContextVersion = (this.globalData.clubContextVersion || 0) + 1;
    this.invalidateUnreadCountRequests();
    this.setUnreadCount(0);
    this.eventBus.emit('session-changed', this.globalData.session);
    this.openClubChooser();
  },

  invalidateUnreadCountRequests() {
    this.unreadCountRequestId = (this.unreadCountRequestId || 0) + 1;
    this.unreadCountRefreshPromise = null;
    this.unreadCountRefreshScope = null;
  },

  async refreshUnreadCount() {
    const { session } = this.globalData;
    if (this.globalData.clubSwitching) return;
    const userId = session && session.user && session.user.id;
    const clubId = session && session.club && session.club.id;
    if (!userId || !clubId || session.memberStatus !== 'active') return;
    const refreshScope = `${userId}:${clubId}`;
    if (this.unreadCountRefreshPromise && this.unreadCountRefreshScope === refreshScope) {
      return this.unreadCountRefreshPromise;
    }

    const requestId = (this.unreadCountRequestId || 0) + 1;
    this.unreadCountRequestId = requestId;
    this.unreadCountRefreshScope = refreshScope;
    const { role, memberStatus } = session;
    const request = (async () => {
      try {
        const count = await fetchUnreadCount();
        const { session: currentSession } = this.globalData;
        if (requestId !== this.unreadCountRequestId) return;
        if (!currentSession || currentSession.role === 'guest') return;
        if (!currentSession.user || currentSession.user.id !== userId) return;
        if (currentSession.role !== role || currentSession.memberStatus !== memberStatus) return;
        if (!currentSession.club || currentSession.club.id !== clubId) return;
        this.setUnreadCount(count);
      } catch (err) {
        // 未读数拉取失败不阻塞主流程，保持上一次数值
      }
    })().finally(() => {
      if (this.unreadCountRefreshPromise !== request) return;
      this.unreadCountRefreshPromise = null;
      this.unreadCountRefreshScope = null;
    });
    this.unreadCountRefreshPromise = request;
    return request;
  },

  setUnreadCount(unreadCount) {
    this.globalData.unreadCount = unreadCount;
    this.eventBus.emit('notice-unread-change', unreadCount);
  },
});
