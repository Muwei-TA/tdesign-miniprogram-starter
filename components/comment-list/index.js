/**
 * 一级评论与定向回复展示组件。
 * 组件只渲染 DTO、只抛事件；请求、身份模式和权限由页面决定。
 */
Component({
  options: { styleIsolation: 'shared' },

  properties: {
    comments: { type: Array, value: [] },
    canComment: { type: Boolean, value: false },
    placeholder: { type: String, value: '写下你的回应…' },
    disabledReason: { type: String, value: '目前不能回应这条内容。' },
    submitting: { type: Boolean, value: false },
    resetKey: { type: Number, value: 0 },
  },

  data: {
    inputValue: '',
    replyToId: '',
    replyLabel: '',
    localSubmitting: false,
  },

  observers: {
    resetKey(value, previous) {
      if (value === previous) return;
      this.setData({ inputValue: '', replyToId: '', replyLabel: '', localSubmitting: false });
    },
    submitting(value) {
      if (!value) this.setData({ localSubmitting: false });
    },
  },

  methods: {
    onInput(e) {
      this.setData({ inputValue: e.detail.value });
    },

    onReply(e) {
      const { id, label } = e.currentTarget.dataset;
      this.setData({ replyToId: id, replyLabel: label || '这条回应' });
    },

    onCancelReply() {
      this.setData({ replyToId: '', replyLabel: '' });
    },

    onSubmit() {
      if (!this.data.canComment || this.data.localSubmitting || this.data.submitting) return;
      const body = this.data.inputValue.trim();
      if (!body) return;
      this.setData({ localSubmitting: true });
      this.triggerEvent('submit', { body, replyToId: this.data.replyToId });
    },
  },
});
