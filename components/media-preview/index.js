/**
 * 媒体展示组件。图片预览只使用服务端返回的授权 URL；视频只抛出播放事件。
 */
Component({
  options: { styleIsolation: 'shared' },

  properties: {
    media: { type: Object, value: { type: null, images: [], video: null } },
    height: { type: String, value: '' },
  },

  data: {
    isGrid: false,
    images: [],
  },

  observers: {
    media(value) {
      // 服务端已限制 9 张；组件再做一层展示上限，避免异常 DTO 撑破布局。
      const images = ((value && value.images) || []).slice(0, 9);
      this.setData({ isGrid: images.length > 1, images });
    },
  },

  methods: {
    onPreview(e) {
      const index = Number(e.currentTarget.dataset.index || 0);
      const images = this.data.images || [];
      if (images.length === 0) return;
      wx.previewImage({ current: images[index], urls: images });
      this.triggerEvent('preview', { index });
    },

    onPlay() {
      this.triggerEvent('play');
    },
  },
});
