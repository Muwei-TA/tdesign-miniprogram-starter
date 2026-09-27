import request from '~/api/request';
import { fetchMyLevels, checkInForToday } from '~/services/levels';
import { getSession, isAdmin } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    session: null,
    isMember: false,
    sessionLoading: true,
    sessionError: false,
    showAdmin: false,
    profile: null,
    stats: { posts: 0, bookmarks: 0, topics: 0 },
    levelSnapshot: null,
    levelTier: 1,
    levelProgressPercent: 0,
    levelRemainingXp: 0,
    nextLevelNum: 2,
    isMaxLevel: false,
    showLevelProgress: false,
    levelsLoading: false,
    levelsError: false,
    checkInSubmitting: false,
    showLevelRules: false,

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

    levelEntries: [
      { level: 1, title: '微光', thresholdXp: 0 },
      { level: 2, title: '新芽', thresholdXp: 40 },
      { level: 3, title: '青枝', thresholdXp: 120 },
      { level: 4, title: '向光', thresholdXp: 280 },
      { level: 5, title: '成荫', thresholdXp: 520 },
      { level: 6, title: '星枝', thresholdXp: 860 },
      { level: 7, title: '林海', thresholdXp: 1320 },
      { level: 8, title: '长明', thresholdXp: 2000 },
    ],
  },

  onLoad() {
    this.onSessionChanged = (session) => {
      // A published session is newer than any page refresh still in flight.
      this.sessionRefreshId = (this.sessionRefreshId || 0) + 1;
      this.syncSession(session);
      this.setData({ sessionLoading: false, sessionError: false });
      this.loadProfile();
      this.loadLevels();
    };
    app.eventBus.on('session-changed', this.onSessionChanged);

    // initSession() runs asynchronously at launch. Until it publishes, the
    // service's default guest value is only a placeholder, not a final state.
    const session = app.globalData && app.globalData.session;
    if (session) {
      this.syncSession(session);
      this.setData({ sessionLoading: false, sessionError: false });
    }
    this.loadProfile();
    this.loadLevels();
  },

  onUnload() {
    this.sessionRefreshId = (this.sessionRefreshId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'my' });
    }
    if (this.data.isMember) this.loadLevels();
  },

  async refreshSession() {
    const refreshId = (this.sessionRefreshId || 0) + 1;
    this.sessionRefreshId = refreshId;
    this.setData({ sessionLoading: true, sessionError: false });

    try {
      const session = await app.refreshSession();
      if (refreshId !== this.sessionRefreshId) return;
      this.syncSession(session);
      this.setData({ sessionLoading: false, sessionError: false });
      this.loadProfile();
      this.loadLevels();
    } catch (err) {
      if (refreshId !== this.sessionRefreshId) return;
      const invalidSession = err && ['unauthenticated', 'membership_invalid'].includes(err.kind);
      if (invalidSession) this.syncSession(getSession());
      this.setData({ sessionLoading: false, sessionError: !invalidSession });
    }
  },

  onSessionRetry() {
    return this.refreshSession();
  },

  async onPullDownRefresh() {
    try {
      await this.refreshSession();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  syncSession(session) {
    if (!session) return;
    const nextUserId = session.memberStatus === 'active' && session.user ? session.user.id : null;
    const identityChanged = this.currentMemberId !== nextUserId;
    this.currentMemberId = nextUserId;
    if (identityChanged) {
      this.levelsRequestId = (this.levelsRequestId || 0) + 1;
      this.checkInRequestId = (this.checkInRequestId || 0) + 1;
      this.profileRequestId = (this.profileRequestId || 0) + 1;
      this.levelsLoadUserId = null;
      this.setData({
        profile: null,
        stats: { posts: 0, bookmarks: 0, topics: 0 },
        levelSnapshot: null,
        levelTier: 1,
        levelProgressPercent: 0,
        levelRemainingXp: 0,
        nextLevelNum: 2,
        isMaxLevel: false,
        showLevelProgress: false,
        levelsLoading: false,
        levelsError: false,
        checkInSubmitting: false,
        showLevelRules: false,
      });
    }
    this.setData({
      session,
      isMember: session.memberStatus === 'active',
      // 管理入口只在服务端返回管理角色时出现；接口仍需鉴权
      showAdmin: isAdmin(),
    });
  },

  async loadProfile() {
    const { session } = this.data;
    const userId = this.data.isMember && session && session.user && session.user.id;
    if (!userId || !this.isCurrentMember(userId)) return;
    const requestId = (this.profileRequestId || 0) + 1;
    this.profileRequestId = requestId;
    try {
      const data = await request('/me/profile');
      if (requestId !== this.profileRequestId || !this.isCurrentMember(userId)) return;
      this.setData({ profile: data, stats: data.stats || this.data.stats });
    } catch (err) {
      // 个人信息读取失败不阻塞页面，其余入口仍可用
    }
  },

  isCurrentMember(userId) {
    const { session } = this.data;
    return this.data.isMember
      && !!userId
      && !!session
      && !!session.user
      && session.user.id === userId
      && this.currentMemberId === userId;
  },

  async loadLevels() {
    const { session } = this.data;
    const userId = this.data.isMember && session && session.user && session.user.id;
    if (!userId || !this.isCurrentMember(userId) || this.data.checkInSubmitting) return;
    if (this.data.levelsLoading && this.levelsLoadUserId === userId) return;

    const requestId = (this.levelsRequestId || 0) + 1;
    this.levelsRequestId = requestId;
    this.levelsLoadUserId = userId;
    this.setData({ levelsLoading: true, levelsError: false });
    try {
      const snapshot = await fetchMyLevels();
      if (requestId !== this.levelsRequestId || !this.isCurrentMember(userId)) return;
      this.applyLevelSnapshot(snapshot);
    } catch (err) {
      if (requestId !== this.levelsRequestId || !this.isCurrentMember(userId)) return;
      this.setData({ levelsError: true });
      if (err && ['unauthenticated', 'membership_invalid'].includes(err.kind)) {
        this.syncSession(getSession());
      }
    } finally {
      if (requestId === this.levelsRequestId && this.isCurrentMember(userId)) {
        this.levelsLoadUserId = null;
        this.setData({ levelsLoading: false });
      }
    }
  },

  applyLevelSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      this.setData({ levelsError: true });
      return;
    }
    const totalXp = Number(snapshot.totalXp);
    const progressXp = Number(snapshot.progressXp);
    const progressTargetXp = Number(snapshot.progressTargetXp);
    const nextLevelXp = snapshot.nextLevelXp == null ? null : Number(snapshot.nextLevelXp);
    const level = Math.min(8, Math.max(1, Number(snapshot.level) || 1));
    const hasNextLevel = Number.isFinite(nextLevelXp) && nextLevelXp > totalXp;
    const isMaxLevel = !hasNextLevel;
    const progressPercent = !isMaxLevel && progressTargetXp > 0
      ? Math.min(100, Math.max(0, (progressXp / progressTargetXp) * 100))
      : 0;
    const today = snapshot.today || {};
    this.setData({
      levelSnapshot: {
        ...snapshot,
        level,
        totalXp: Number.isFinite(totalXp) ? totalXp : 0,
        progressXp: Number.isFinite(progressXp) ? progressXp : 0,
        progressTargetXp: Number.isFinite(progressTargetXp) ? progressTargetXp : 0,
        today,
      },
      levelTier: level,
      levelProgressPercent: progressPercent,
      levelRemainingXp: hasNextLevel ? Math.max(0, nextLevelXp - totalXp) : 0,
      nextLevelNum: Math.min(8, level + 1),
      isMaxLevel,
      showLevelProgress: !isMaxLevel,
      levelsError: false,
      checkInSubmitting: false,
    });
  },

  async onCheckInTap() {
    const { session } = this.data;
    const userId = this.data.isMember && session && session.user && session.user.id;
    if (!userId || !this.isCurrentMember(userId) || this.data.checkInSubmitting) return;
    if (this.data.levelSnapshot && this.data.levelSnapshot.today.checkedIn) return;

    const requestId = (this.checkInRequestId || 0) + 1;
    this.checkInRequestId = requestId;
    this.levelsRequestId = (this.levelsRequestId || 0) + 1;
    this.levelsLoadUserId = null;
    this.setData({ checkInSubmitting: true, levelsLoading: false });
    try {
      const result = await checkInForToday();
      if (requestId !== this.checkInRequestId || !this.isCurrentMember(userId)) return;
      this.applyLevelSnapshot(result);
      const awardedXp = Number(result && result.awardedXp) || 0;
      wx.showToast({
        title: awardedXp > 0 ? `签到成功，经验 +${awardedXp}` : '今天已签到',
        icon: 'none',
      });
    } catch (err) {
      if (requestId !== this.checkInRequestId || !this.isCurrentMember(userId)) return;
      this.setData({ checkInSubmitting: false, levelsError: true });
      if (err && ['unauthenticated', 'membership_invalid'].includes(err.kind)) {
        this.syncSession(getSession());
      }
      wx.showToast({ title: '签到失败，请稍后重试', icon: 'none' });
    }
  },

  onLevelsRetry() {
    return this.loadLevels();
  },

  onLevelRulesTap() {
    this.setData({ showLevelRules: true });
  },

  onLevelRulesClose() {
    this.setData({ showLevelRules: false });
  },

  stopLevelRulesTap() {
    return false;
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
        app.invalidateSession();
        this.setData({ profile: null, stats: { posts: 0, bookmarks: 0, topics: 0 } });
        wx.showToast({ title: '已切换为访客', icon: 'none' });
      },
    });
  },
});
