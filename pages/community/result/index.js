import { navigateTo } from '~/utils/navigate';

/**
 * P17 发布结果页。
 * 文案必须基于真实服务端结果，禁止在待审状态写"发布成功，大家都能看到"。
 */
const STATE_TEXT = {
  private_saved: {
    title: '先留给自己',
    desc: '这条内容只有你能看到，不会进入社区流、话题、搜索与互动。',
    primary: '查看私密手记',
    tab: 'private',
  },
  pending: {
    title: '已收到，等待审核',
    desc: '通过后会在你设定的范围内展示。结果会通过站内消息告知。',
    primary: '查看我的发布',
    tab: 'pending',
  },
  rejected: {
    title: '这条内容需要修改',
    desc: '内容未通过安全检查，原文已保留。可以在我的内容查看处理说明。',
    primary: '查看处理说明',
    tab: 'pending',
  },
  published: {
    title: '已在设定范围内展示',
    desc: '现在符合范围的读者可以看到它了。',
    primary: '查看内容',
    tab: 'published',
  },
};

const SCOPE_TEXT = {
  public: '公开可见',
  club: '仅社内可见',
  private: '只有自己可见',
};

Page({
  data: {
    state: 'pending',
    scope: 'club',
    identity: 'named',
    id: '',
    title: '',
    desc: '',
    primary: '',
    tab: 'pending',
    summary: '',
  },

  onLoad(options) {
    const state = STATE_TEXT[options.state] ? options.state : 'pending';
    const conf = STATE_TEXT[state];
    const scope = options.scope || 'club';
    const identity = options.identity || 'named';

    this.setData({
      state,
      scope,
      identity,
      id: options.id || '',
      title: conf.title,
      desc: conf.desc,
      primary: conf.primary,
      tab: conf.tab,
      summary: `身份：${identity === 'anonymous' ? '树洞身份' : '你的昵称'} · 范围：${SCOPE_TEXT[scope] || scope}`,
    });
  },

  onPrimary() {
    if (this.data.state === 'published' && this.data.id) {
      navigateTo(`/pages/community/post/index?id=${encodeURIComponent(this.data.id)}&from=result`);
      return;
    }
    navigateTo(`/pages/community/my-content/index?tab=${this.data.tab}`);
  },

  onBackHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  /** 继续写：全新内容，默认回到社内 + 署名 */
  onWriteAgain() {
    wx.redirectTo({ url: '/pages/release/index' });
  },
});
