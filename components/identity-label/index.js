/**
 * 身份标签只渲染服务端 DTO。
 * 匿名态点击只能解释边界，绝不抛出主页跳转事件。
 */
Component({
  options: { styleIsolation: 'shared' },

  properties: {
    identityMode: { type: String, value: 'named' },
    displayName: { type: String, value: '' },
    alias: { type: String, value: '' },
    userId: { type: String, value: '' },
    avatar: { type: String, value: '' },
    isAuthor: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      const isAnonymous = this.data.identityMode === 'anonymous';
      if (isAnonymous) {
        this.triggerEvent('explain');
        return;
      }
      this.triggerEvent('tapname', { userId: this.data.userId || null, isAnonymous: false });
    },
  },
});
