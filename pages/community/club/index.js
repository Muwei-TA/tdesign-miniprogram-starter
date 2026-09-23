import { fetchMembershipSession, fetchMyMembershipApplication } from '../membership';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const MEMBER_STATUS_TEXT = {
  none: {
    title: '还不是社内成员',
    desc: '先了解这里，再决定是否提交申请。',
    action: '申请加入',
  },
  pending: {
    title: '申请等待确认',
    desc: '管理员确认后，成员资格会在会话刷新时生效。',
    action: '查看申请状态',
  },
  active: {
    title: '你已加入黑光文学社',
    desc: '社内内容只对当前有效成员开放。',
    action: '',
  },
  rejected: {
    title: '申请暂未通过',
    desc: '这不等于你的表达有问题，可以联系管理员了解原因。',
    action: '查看申请状态',
  },
  removed: {
    title: '成员资格已撤回',
    desc: '如需重新加入，可以重新阅读约定并提交申请。',
    action: '重新申请',
  },
};

function statusFromSession(session) {
  if (!session) return 'none';
  return MEMBER_STATUS_TEXT[session.memberStatus] ? session.memberStatus : 'none';
}

function errorTextForLoad(err) {
  if (err && err.kind === 'network') return '网络暂时不可用，社团资料还没有更新。';
  if (err && err.kind === 'timeout') return '请求超时，社团资料还没有更新。';
  return (err && err.message) || '社团资料暂时无法读取。';
}

Page({
  data: {
    club: null,
    session: null,
    memberStatus: 'none',
    memberStatusText: MEMBER_STATUS_TEXT.none,
    applicationReason: '',
    loading: true,
    loadError: '',
  },

  onLoad() {
    this.onSessionChanged = (session) => {
      const memberStatus = statusFromSession(session);
      this.setData({
        session,
        memberStatus,
        memberStatusText: MEMBER_STATUS_TEXT[memberStatus],
      });
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    this.loadClub();
  },

  onUnload() {
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  onShow() {
    if (this.data.club) this.loadClub({ silent: true });
  },

  async loadClub({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true, loadError: '' });
    try {
      const session = await fetchMembershipSession();
      const memberStatus = statusFromSession(session);
      this.setData({
        session,
        club: session && session.club ? session.club : null,
        memberStatus,
        memberStatusText: MEMBER_STATUS_TEXT[memberStatus],
        loading: false,
        loadError: '',
      });

      if (session && session.user && memberStatus !== 'active') {
        try {
          const application = await fetchMyMembershipApplication();
          const applicationStatus = application && application.state;
          if (applicationStatus && MEMBER_STATUS_TEXT[applicationStatus]) {
            this.setData({
              memberStatus: applicationStatus,
              memberStatusText: MEMBER_STATUS_TEXT[applicationStatus],
              applicationReason: application.reason || '',
            });
          }
        } catch (err) {
          // 申请状态读取失败不覆盖已加载的社团介绍。
        }
      }
    } catch (err) {
      this.setData({ loading: false, loadError: errorTextForLoad(err) });
    }
  },

  onRetry() {
    this.loadClub();
  },

  onJoinTap() {
    navigateTo('/pages/community/join/index?from=club');
  },

  onRulesTap() {
    navigateTo('/pages/community/rules/index?from=club');
  },
});
