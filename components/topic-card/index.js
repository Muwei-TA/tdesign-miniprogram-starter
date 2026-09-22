Component({
  options: { styleIsolation: 'shared' },

  properties: {
    topic: { type: Object, value: null },
    /** list | banner */
    mode: { type: String, value: 'list' },
  },

  data: {
    statusText: '',
    canFollow: true,
  },

  observers: {
    topic(value) {
      if (!value) return;
      const map = { pending: '待审核', archived: '已归档' };
      this.setData({
        statusText: map[value.status] || '',
        // 待审核话题不可关注；归档话题可读不可新增
        canFollow: value.status === 'active',
      });
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.topic.id });
    },

    onFollow() {
      const { topic, canFollow } = this.data;
      if (!canFollow) return;
      this.triggerEvent('follow', { id: topic.id, next: !topic.followed });
    },
  },
});
