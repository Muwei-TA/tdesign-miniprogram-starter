Component({
  options: { styleIsolation: 'shared' },

  properties: {
    item: { type: Object, value: {} },
    actions: { type: Array, value: [] },
  },

  methods: {
    onAction(e) {
      this.triggerEvent('action', {
        key: e.currentTarget.dataset.key,
        id: this.data.item.id,
      });
    },

    onDetail() {
      this.triggerEvent('detail', { id: this.data.item.id });
    },
  },
});
