import { fetchMembershipSession } from '~/services/membership';

const CLUB_RULES = [
  { title: '不涉黄', body: '不发布露骨色情内容，也不把他人当作猎奇对象。' },
  { title: '不涉政', body: '不发布法律法规禁止传播的政治内容，不把社团变成动员场所。' },
  { title: '不人身攻击', body: '可以不同意作品和观点，但不羞辱、威胁或围堵具体的人。' },
  { title: '不骚扰', body: '不反复私下打扰、跟踪、逼迫回应，也不利用匿名身份伤害他人。' },
  { title: '不披露他人隐私', body: '发布故事、截图或照片前，先去掉足以识别他人的信息并取得必要同意。' },
  { title: '尊重作品来源', body: '引用、改写或使用他人作品时说明来源；不把未经授权的作品说成自己的。' },
  { title: '举报与申诉', body: '遇到问题可以举报，处理结果不等于对任何一方的公开定性；对处理有疑问可以申诉。' },
  { title: '匿名边界', body: '树洞身份会隐藏昵称与头像，但不是绝对匿名。具体经历、地名、画面和文风仍可能让人猜到。' },
  { title: '公开范围解释', body: '公开可见意味着打开本小程序的人都可能看到；社内内容只对当前有效成员开放。' },
];

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
      { key: 'club', title: '社团约定', intro: '这是我们在社内共同遵守的相处方式。', type: 'rules', items: CLUB_RULES },
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

  onLoad() {
    this.loadRules();
  },

  async loadRules() {
    this.setData({ loading: true, loadError: '' });
    try {
      const session = await fetchMembershipSession();
      const club = session && session.club;
      if (!club) {
        this.setData({ loading: false, club: null });
        return;
      }
      const version = club.rulesVersion || 'v1.1';
      this.setData({
        loading: false,
        club,
        version,
        changeSummary:
          version === 'v1.1'
            ? '在原有三项约定基础上，补充骚扰、隐私、作品来源、举报申诉、匿名边界与公开范围说明，并将三层规则分开呈现。'
            : '当前版本由社团会话提供；如规则发生变化，页面会同步显示新的版本号与变更摘要。',
      });
    } catch (err) {
      this.setData({ loading: false, loadError: errorTextForLoad(err) });
    }
  },

  onRetry() {
    this.loadRules();
  },
});
