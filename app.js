// app.js
import config from './config';
import createBus from './utils/eventBus';
import { fetchUnreadCount } from './services/notifications';
import { bootstrapSession, refreshSessionFromServer, clearAccountScope } from './services/session';

App({
  globalData: {
    /** 会话与成员状态，唯一来源是 services/session.js */
    session: null,
    /** 站内未读通知数（消息入口在树洞首页顶部） */
    unreadCount: 0,
  },

  /** 全局事件总线，事件契约见 docs/03-routing-and-navigation.md 3.5 */
  eventBus: createBus(),

  onLaunch() {
    this.initCloudBase();
    this.checkUpdate();
    this.initSession();
  },

  onHide() {
    this.wasHidden = true;
  },

  onShow() {
    // 冷启动时仍由 initSession 在会话恢复后拉取；这里只刷新后台返回后的未读数。
    if (!this.wasHidden) return;
    this.wasHidden = false;
    const { session } = this.globalData;
    if (!session || session.role === 'guest') return;
    return this.refreshUnreadCount();
  },

  /** CloudBase 小程序身份由微信自动注入，不再交换或持久化会话令牌。 */
  initCloudBase() {
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

  /** 冷启动恢复会话，失败时按访客处理（fail-closed） */
  async initSession() {
    const session = await bootstrapSession();
    this.publishSession(session);
    if (session.role !== 'guest') {
      this.refreshUnreadCount();
    }
  },

  /** 页面重新显示时读取服务端会话，避免沿用已经过期的成员状态。 */
  async refreshSession() {
    const session = await refreshSessionFromServer();
    this.publishSession(session);
    return session;
  },

  publishSession(session) {
    const { session: previousSession } = this.globalData;
    const previousUserId = previousSession && previousSession.user && previousSession.user.id;
    const nextUserId = session && session.user && session.user.id;
    const sessionScopeChanged = !previousSession
      || previousUserId !== nextUserId
      || previousSession.role !== session.role
      || previousSession.memberStatus !== session.memberStatus;
    if (sessionScopeChanged) {
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
    this.globalData.session = session;
    this.setUnreadCount(0);
    this.eventBus.emit('session-changed', session);
  },

  invalidateUnreadCountRequests() {
    this.unreadCountRequestId = (this.unreadCountRequestId || 0) + 1;
    this.unreadCountRefreshPromise = null;
    this.unreadCountRefreshUserId = null;
  },

  async refreshUnreadCount() {
    const { session } = this.globalData;
    const userId = session && session.user && session.user.id;
    if (!userId || session.role === 'guest') return;
    if (this.unreadCountRefreshPromise && this.unreadCountRefreshUserId === userId) {
      return this.unreadCountRefreshPromise;
    }

    const requestId = (this.unreadCountRequestId || 0) + 1;
    this.unreadCountRequestId = requestId;
    this.unreadCountRefreshUserId = userId;
    const { role, memberStatus } = session;
    const request = (async () => {
      try {
        const count = await fetchUnreadCount();
        const { session: currentSession } = this.globalData;
        if (requestId !== this.unreadCountRequestId) return;
        if (!currentSession || currentSession.role === 'guest') return;
        if (!currentSession.user || currentSession.user.id !== userId) return;
        if (currentSession.role !== role || currentSession.memberStatus !== memberStatus) return;
        this.setUnreadCount(count);
      } catch (err) {
        // 未读数拉取失败不阻塞主流程，保持上一次数值
      }
    })().finally(() => {
      if (this.unreadCountRefreshPromise !== request) return;
      this.unreadCountRefreshPromise = null;
      this.unreadCountRefreshUserId = null;
    });
    this.unreadCountRefreshPromise = request;
    return request;
  },

  setUnreadCount(unreadCount) {
    this.globalData.unreadCount = unreadCount;
    this.eventBus.emit('notice-unread-change', unreadCount);
  },
});
