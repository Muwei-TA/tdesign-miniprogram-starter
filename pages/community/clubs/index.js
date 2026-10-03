import Page from '~/utils/themed-page';
import { fetchMyClubs, fetchClubs } from '~/services/clubs';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

Page({
  data: {
    currentClubId: '',
    myClubs: [],
    directory: [],
    loading: true,
    loadingMore: false,
    errorText: '',
    switchingClubId: '',
  },

  onLoad(options) {
    if (options.clubId) this.requestedClubId = options.clubId;
    this.onSessionChanged = (session) => {
      this.setData({ currentClubId: (session && session.club && session.club.id) || '' });
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    const { session } = app.globalData;
    this.setData({ currentClubId: (session && session.club && session.club.id) || '' });
    return this.loadClubs();
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  async loadClubs() {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.setData({ loading: true, errorText: '' });
    try {
      const [myClubs, directory] = await Promise.all([fetchMyClubs(), fetchClubs()]);
      if (requestId !== this.requestId) return;
      const myClubsWithApplications = myClubs.filter((club) => club
        && club.status === 'active'
        && ['active', 'pending', 'rejected', 'removed'].includes(club.memberStatus)
        && club.id);
      app.globalData.clubMemberships = myClubsWithApplications.filter((club) => club.memberStatus === 'active');
      const myIds = new Set(myClubsWithApplications.map((club) => club.id));
      this.setData({
        myClubs: myClubsWithApplications,
        directory: directory.filter((club) => !myIds.has(club.id)),
        loading: false,
      });
      if (this.requestedClubId) {
        const isMember = app.globalData.clubMemberships.some((club) => club.id === this.requestedClubId
          && club.status === 'active'
          && club.memberStatus === 'active');
        if (isMember && await app.resolveClubLink(this.requestedClubId)) {
          wx.switchTab({ url: '/pages/home/index' });
        } else {
          this.onJoinClub({ currentTarget: { dataset: { id: this.requestedClubId } } });
        }
      }
    } catch (err) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, errorText: err.message || '社团列表暂时无法读取' });
    }
  },

  async onSelectClub(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    const club = this.data.myClubs.find((item) => item.id === id);
    if (club && club.memberStatus === 'removed') {
      this.onMyClubContent(e);
      return;
    }
    if (!club || club.memberStatus !== 'active') {
      this.onJoinClub(e);
      return;
    }
    if (this.data.switchingClubId) return;
    this.setData({ switchingClubId: id });
    try {
      const selected = await app.selectClub(id);
      if (!selected) throw new Error('该社团暂不可用');
      wx.switchTab({ url: '/pages/home/index' });
    } catch (err) {
      wx.showToast({ title: err.message || '社团切换失败，已保留当前社团', icon: 'none' });
    } finally {
      this.setData({ switchingClubId: '' });
    }
  },

  onJoinClub(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    navigateTo(`/pages/community/join/index?clubId=${encodeURIComponent(id)}&from=clubs`);
  },

  onMyClubContent(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    navigateTo(`/pages/community/my-content/index?clubId=${encodeURIComponent(id)}&historyOnly=1&tab=published`);
  },

  onRetry() {
    return this.loadClubs();
  },
});
