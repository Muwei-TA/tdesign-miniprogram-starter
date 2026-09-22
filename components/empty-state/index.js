Component({
  options: { styleIsolation: 'shared' },

  properties: {
    icon: { type: String, value: 'chat-bubble-1' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    /** 按钮文案，空则不显示 */
    action: { type: String, value: '' },
    /** default | inline */
    variant: { type: String, value: 'default' },
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
