// 四主入口：树洞 / 话题 / 文集 / 我的
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
    label: '文集',
    icon: 'book-open',
    iconActive: 'book-open-filled',
    path: '/pages/anthology/index',
  },
  { value: 'my', label: '我的', icon: 'user', iconActive: 'user-filled', path: '/pages/my/index' },
];

Component({
  options: {
    styleIsolation: 'shared',
  },

  data: {
    value: '',
    list: TAB_LIST,
  },

  lifetimes: {
    ready() {
      this.syncActive();
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
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current) return;
      const matched = TAB_LIST.find((item) => item.path === `/${current.route}`);
      if (matched && matched.value !== this.data.value) {
        this.setData({ value: matched.value });
      }
    },

    handleChange(e) {
      const { value } = e.currentTarget.dataset;
      const target = TAB_LIST.find((item) => item.value === value);
      if (!target || value === this.data.value) return;
      wx.switchTab({ url: target.path });
    },
  },
});
