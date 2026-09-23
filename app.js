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
    this.globalData.session = session;
    this.eventBus.emit('session-changed', session);
  },

  invalidateSession() {
    const session = clearAccountScope();
    this.globalData.session = session;
    this.setUnreadCount(0);
    this.eventBus.emit('session-changed', session);
  },

  async refreshUnreadCount() {
    try {
      const count = await fetchUnreadCount();
      this.setUnreadCount(count);
    } catch (err) {
      // 未读数拉取失败不阻塞主流程，保持上一次数值
    }
  },

  setUnreadCount(unreadCount) {
    this.globalData.unreadCount = unreadCount;
    this.eventBus.emit('notice-unread-change', unreadCount);
  },
});
