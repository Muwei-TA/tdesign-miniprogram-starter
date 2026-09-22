import { getSession } from '~/services/session';

/**
 * 昵称与头像编辑。
 * 最小数据采集：不索取生日、院系、学号、手机号、位置（docs/01 1.4 / docs/08 P09）。
 */
Page({
  data: {
    displayName: '',
    avatar: '',
    saving: false,
  },

  onLoad() {
    const { user } = getSession();
    this.setData({
      displayName: (user && user.displayName) || '',
      avatar: (user && user.avatar) || '',
    });
  },

  onNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        this.setData({ avatar: res.tempFiles[0].tempFilePath });
      },
    });
  },

  onSave() {
    const name = this.data.displayName.trim();
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: '昵称请控制在 20 字内', icon: 'none' });
      return;
    }
    // 真实保存接口与头像上传由任务 T-14 接入
    wx.showToast({ title: '资料保存待接入（T-14）', icon: 'none' });
  },
});
