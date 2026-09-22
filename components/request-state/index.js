/** 请求状态展示组件：只渲染状态，不请求数据、不判断业务权限。 */
Component({
  options: { styleIsolation: 'shared' },

  properties: {
    state: { type: String, value: 'idle' },
    errorKind: { type: String, value: '' },
    stale: { type: Boolean, value: false },
  },

  methods: {
    onRetry() {
      this.triggerEvent('retry');
    },
  },
});
