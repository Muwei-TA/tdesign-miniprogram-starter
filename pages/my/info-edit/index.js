import { bootstrapSession, getSession } from '~/services/session';
import { updateMyProfile } from '~/services/profiles';

const app = getApp();

/**
 * 昵称与头像编辑。
 * 最小数据采集：不索取生日、院系、学号、手机号、位置（docs/01 1.4 / docs/08 P09）。
 */
Page({
  data: {
    displayName: '',
    avatar: '',
    saving: false,
  },

  onLoad() {
    this.syncSession(getSession());
    this.onSessionChanged = (session) => this.syncSession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  syncSession(session) {
    const user = session && session.user;
    this.setData({
      displayName: (user && user.displayName) || '',
      avatar: (user && user.avatar) || '',
    });
  },

  onNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  onChooseAvatar() {
    wx.showModal({
      title: '头像暂未开放',
      content: '头像上传、审核与存储链路还在验收中，当前只支持保存文字昵称。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async onSave() {
    if (this.data.saving) return;
    const name = this.data.displayName.trim();
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: '昵称请控制在 20 字内', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await updateMyProfile(name);
      // 重新读取服务端会话，让昵称更新同步到所有页面与全局事件总线。
      const session = await bootstrapSession();
      app.globalData.session = session;
      app.eventBus.emit('session-changed', session);
      this.setData({ saving: false });
      wx.showToast({ title: '已保存', icon: 'none' });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存未完成', icon: 'none' });
    }
  },
});
