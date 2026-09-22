/**
 * 可见范围选择弹层。
 *
 * 规则（docs/07 7.12 / docs/05 5.7）：
 * 1. allowPublic 来自服务端 capabilities.publicScope；关闭时不渲染 public 选项，也不允许提交该值。
 * 2. mode='shrink' 时只显示比当前更小的范围（首版禁止扩大）。
 * 3. 每个选项必须带解释文案，不能只给一个词。
 */
const OPTIONS = [
  {
    value: 'public',
    icon: 'earth',
    title: '公开可见',
    desc: '任何打开本小程序的人都可能看到。',
    rank: 3,
  },
  {
    value: 'club',
    icon: 'usergroup',
    title: '仅社内可见',
    desc: '只有当前有效成员能看到。新内容默认选这一项。',
    rank: 2,
  },
  {
    value: 'private',
    icon: 'lock-on',
    title: '只有自己可见',
    desc: '不进入社区流、话题、搜索与互动。',
    rank: 1,
  },
];

Component({
  options: { styleIsolation: 'shared' },

  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: 'club' },
    allowPublic: { type: Boolean, value: false },
    /** create | shrink */
    mode: { type: String, value: 'create' },
  },

  data: {
    options: [],
  },

  observers: {
    'visible, value, allowPublic, mode': function observe() {
      const { value, allowPublic, mode } = this.data;
      const currentRank = (OPTIONS.find((item) => item.value === value) || {}).rank || 2;
      const options = OPTIONS.filter((item) => {
        if (item.value === 'public' && !allowPublic) return false;
        // 缩小模式只保留更小的范围
        if (mode === 'shrink' && item.rank >= currentRank) return false;
        return true;
      });
      this.setData({ options });
    },
  },

  methods: {
    onSelect(e) {
      const { value } = e.currentTarget.dataset;
      this.triggerEvent('change', { value });
    },

    onClose() {
      this.triggerEvent('close');
    },

    noop() {},
  },
});
