// 四主入口：树洞 / 话题 / 文稿 / 我的
// 消息不占 Tab，从树洞首页顶部进入（见 docs/03-routing-and-navigation.md）
const TAB_LIST = [
  { value: 'home', label: '树洞', icon: 'home', iconActive: 'home-filled', path: '/pages/home/index' },
  {
    value: 'topics',
    label: '话题',
    icon: 'chat-bubble-1',
    iconActive: 'chat-bubble-1-filled',
    path: '/pages/topics/index',
  },
  {
    value: 'anthology',
    label: '文稿',
    icon: 'book-open',
    iconActive: 'book-open-filled',
    path: '/pages/anthology/index',
  },
  { value: 'my', label: '我的', icon: 'user', iconActive: 'user-filled', path: '/pages/my/index' },
];
const app = getApp();

Component({
  options: {
    styleIsolation: 'shared',
  },

  data: {
    value: '',
    list: TAB_LIST,
    isBlackbox: false,
  },

  lifetimes: {
    ready() {
      this.onSessionChanged = () => this.syncActive();
      app.eventBus.on('session-changed', this.onSessionChanged);
      this.syncActive();
    },
    detached() {
      if (this.onSessionChanged) app.eventBus.off('session-changed', this.onSessionChanged);
    },
  },

  pageLifetimes: {
    show() {
      this.syncActive();
    },
  },

  methods: {
    /** 依据当前页面路径同步选中态，避免首次加载闪烁 */
    syncActive() {
      const isBlackbox = !!(app.globalData.session && app.globalData.session.club
        && app.globalData.session.club.id === 'blackbox-animation');
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current) {
        this.setData({ isBlackbox });
        return;
      }
      const matched = TAB_LIST.find((item) => item.path === `/${current.route}`);
      this.setData({ isBlackbox, ...(matched && matched.value !== this.data.value ? { value: matched.value } : {}) });
    },

    handleChange(e) {
      const { value } = e.currentTarget.dataset;
      const target = TAB_LIST.find((item) => item.value === value);
      if (!target || value === this.data.value) return;
      wx.switchTab({ url: target.path });
    },
  },
});
