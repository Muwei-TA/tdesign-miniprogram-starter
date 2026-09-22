/**
 * 范围标识。颜色不得单独承担语义：必须同时有图标与文字（docs/06 6.2）。
 */
const MAP = {
  public: { icon: 'earth', text: '公开可见' },
  club: { icon: 'usergroup', text: '仅社内可见' },
  private: { icon: 'lock-on', text: '只有自己可见' },
};

Component({
  options: { styleIsolation: 'shared' },

  properties: {
    scope: { type: String, value: 'club' },
    /** sm | md */
    size: { type: String, value: 'sm' },
    withText: { type: Boolean, value: true },
  },

  data: {
    icon: 'usergroup',
    text: '仅社内可见',
  },

  observers: {
    scope(value) {
      const conf = MAP[value] || MAP.club;
      this.setData({ icon: conf.icon, text: conf.text });
    },
  },
});
