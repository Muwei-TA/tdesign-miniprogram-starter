import Page from '~/utils/themed-page';
import { fetchClub } from '~/services/clubs';

const app = getApp();

const PLATFORM_RULES = [
  '遵守微信小程序平台规范与内容审核要求，提交后可能进入审核流程。',
  '不利用社团功能传播恶意程序、垃圾信息、诈骗或侵犯他人合法权益的内容。',
  '内容需要调整时，我们会给出处理状态或原因；平台能力不承诺内容一定被推荐或收录。',
];

const LEGAL_RULES = [
  '不得发布法律法规禁止传播的内容，不得侵害他人的名誉、隐私、著作权等合法权益。',
  '涉及未成年人、个人信息或他人作品时，遵循适用的法律义务与必要授权要求。',
  '收到依法提出的处理、协查或保存要求时，运营方会在法定范围内履行义务。',
];

function errorTextForLoad(err) {
  if (err && err.kind === 'network') return '网络暂时不可用，版本信息还没有更新。';
  if (err && err.kind === 'timeout') return '请求超时，版本信息还没有更新。';
  return (err && err.message) || '约定版本暂时无法读取。';
}

Page({
  data: {
    club: null,
    version: '',
    changeSummary: '',
    sections: [
      { key: 'club', title: '社团约定', intro: '这是我们在社内共同遵守的相处方式。', type: 'rules', items: [] },
      {
        key: 'platform',
        title: '平台要求',
        intro: '使用小程序能力时，还需要遵守平台的公开规则。',
        type: 'plain',
        items: PLATFORM_RULES,
      },
      {
        key: 'legal',
        title: '法律义务',
        intro: '法律义务适用于所有人，不因匿名、社内范围或作品形式而消失。',
        type: 'plain',
        items: LEGAL_RULES,
      },
    ],
    loading: true,
    loadError: '',
  },

  onLoad(options) {
    this.clubId = options.clubId || (app.globalData.session && app.globalData.session.club
      && app.globalData.session.club.id) || '';
    this.onSessionChanged = (session) => {
      const nextClubId = session && session.club && session.club.id;
      if (nextClubId === this.clubId) return;
      this.rulesRequestId = (this.rulesRequestId || 0) + 1;
      this.clubId = '';
      this.setData({ club: null, version: '', loading: false, loadError: '' });
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    this.loadRules();
  },

  onUnload() {
    this.rulesRequestId = (this.rulesRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
  },

  async loadRules() {
    if (!this.clubId) {
      this.setData({ loading: false, club: null });
      return;
    }
    const requestId = (this.rulesRequestId || 0) + 1;
    this.rulesRequestId = requestId;
    this.setData({ loading: true, loadError: '' });
    try {
      const club = await fetchClub(this.clubId);
      if (requestId !== this.rulesRequestId) return;
      if (!club) {
        this.setData({ loading: false, club: null });
        return;
      }
      const version = club.rulesVersion || 'v1.1';
      this.setData({
        loading: false,
        club,
        version,
        sections: this.data.sections.map((section) => section.key === 'club'
          ? { ...section, items: Array.isArray(club.rules) ? club.rules : [], intro: Array.isArray(club.rules) ? section.intro : '本社团尚未配置可展示的约定条目。' }
          : section),
        changeSummary:
          club.rulesSummary || '规则版本由当前社团提供。',
      });
    } catch (err) {
      if (requestId !== this.rulesRequestId) return;
      this.setData({ loading: false, loadError: errorTextForLoad(err) });
    }
  },

  onRetry() {
    this.loadRules();
  },
});
