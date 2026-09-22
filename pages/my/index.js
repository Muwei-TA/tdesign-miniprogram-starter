import request from '~/api/request';
import { getSession, isAdmin, clearAccountScope } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    session: null,
    isMember: false,
    showAdmin: false,
    profile: null,
    stats: { posts: 0, bookmarks: 0, topics: 0 },

    contentEntries: [
      { tab: 'published', name: '已发布', icon: 'root-list' },
      { tab: 'pending', name: '待审核 / 需要修改', icon: 'time' },
      { tab: 'draft', name: '草稿', icon: 'file-copy' },
      { tab: 'private', name: '私密手记', icon: 'lock-on' },
      { tab: 'bookmark', name: '收藏', icon: 'bookmark' },
      { tab: 'topics', name: '关注的话题', icon: 'chat-bubble-1' },
    ],

    clubEntries: [
      { key: 'club', name: '社团名片', icon: 'usergroup', url: '/pages/community/club/index' },
      { key: 'rules', name: '社区约定', icon: 'secured', url: '/pages/community/rules/index' },
    ],
  },

  onLoad() {
    this.syncSession(getSession());
    this.onSessionChanged = (session) => {
      this.syncSession(session);
      this.loadProfile();
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    this.loadProfile();
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'my' });
    }
  },

  syncSession(session) {
    if (!session) return;
    this.setData({
      session,
      isMember: session.memberStatus === 'active',
      // 管理入口只在服务端返回管理角色时出现；接口仍需鉴权
      showAdmin: isAdmin(),
    });
  },

  async loadProfile() {
    if (!this.data.isMember) return;
    try {
      const data = await request('/me/profile');
      this.setData({ profile: data, stats: data.stats || this.data.stats });
    } catch (err) {
      // 个人信息读取失败不阻塞页面，其余入口仍可用
    }
  },

  onContentTap(e) {
    const { tab } = e.currentTarget.dataset;
    navigateTo(`/pages/community/my-content/index?tab=${tab}`);
  },

  onClubTap(e) {
    navigateTo(e.currentTarget.dataset.url);
  },

  onAdminTap() {
    navigateTo('/pages/admin/index?queue=content');
  },

  onSettingTap() {
    navigateTo('/pages/setting/index');
  },

  onMessageTap() {
    navigateTo('/pages/message/index');
  },

  onEditTap() {
    navigateTo('/pages/my/info-edit/index');
  },

  onJoinTap() {
    navigateTo('/pages/community/join/index?from=my');
  },

  onLogout() {
    wx.showModal({
      title: '退出账号',
      content: '将清除本机缓存并切换为访客。云端内容不会被删除。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return;
        const session = clearAccountScope();
        app.globalData.session = session;
        app.eventBus.emit('session-changed', session);
        this.syncSession(session);
        this.setData({ profile: null, stats: { posts: 0, bookmarks: 0, topics: 0 } });
        wx.showToast({ title: '已切换为访客', icon: 'none' });
      },
    });
  },
});
