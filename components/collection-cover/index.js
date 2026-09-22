Component({
  options: { styleIsolation: 'shared' },

  properties: {
    collection: { type: Object, value: null },
    /** grid | hero */
    size: { type: String, value: 'grid' },
  },

  data: {
    countText: '',
  },

  observers: {
    collection(value) {
      if (!value) return;
      // 空文集显示征集引导，不假造已收录作品数（docs/08 P06）
      this.setData({
        countText: value.count > 0 ? `${value.count} 篇` : '还在征集',
      });
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.collection.id });
    },
  },
});
