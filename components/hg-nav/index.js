Component({
  options: {
    styleIsolation: 'shared',
    multipleSlots: true,
  },

  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    /** plain | search */
    variant: { type: String, value: 'plain' },
    /** [{ key, icon, badge }] */
    tools: { type: Array, value: [] },
    /** paper | transparent | dark */
    theme: { type: String, value: 'paper' },
  },

  data: {
    statusHeight: 20,
  },

  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusHeight: info.statusBarHeight || 20 });
    },
  },

  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        // 栈空（分享/深链进入）时回到树洞，不使用 reLaunch 以外的兜底
        wx.switchTab({ url: '/pages/home/index' });
      }
      this.triggerEvent('back');
    },

    onToolTap(e) {
      this.triggerEvent('tooltap', { key: e.currentTarget.dataset.key });
    },

    onSearchTap() {
      this.triggerEvent('searchtap');
    },
  },
});
