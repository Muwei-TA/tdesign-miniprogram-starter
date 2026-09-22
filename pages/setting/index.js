import { getCapabilities, getSession, scopedKey } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

/**
 * P13 设置与隐私（基线版本）。
 * 完整验收项见 docs/08 P13；导出与注销的真实链路属任务 T-12 / 后端。
 */
Page({
  data: {
    capabilities: { export: false },
    isMember: false,
    readingFontIndex: 1,
    nightMode: false,
    rulesVersion: 'v1.1',
  },

  onLoad() {
    const prefs = wx.getStorageSync(scopedKey('reading-prefs')) || {};
    this.setData({
      capabilities: getCapabilities(),
      isMember: getSession().memberStatus === 'active',
      readingFontIndex: typeof prefs.fontIndex === 'number' ? prefs.fontIndex : 1,
      nightMode: !!prefs.nightMode,
    });
  },

  onScopeExplain() {
    wx.showModal({
      title: '默认可见范围',
      content: '新内容默认「仅社内可见」。公开发布需要主体资质与内容治理能力核验完成后才会开放。',
      showCancel: false,
    });
  },

  onIdentityExplain() {
    wx.showModal({
      title: '树洞身份的边界',
      content: '以树洞身份发布时，其他人看不到你的昵称与头像。这不是绝对匿名——具体经历、地名、画面与文风仍可能让人猜到你，截图也无法追回。',
      showCancel: false,
    });
  },

  onRulesTap() {
    navigateTo('/pages/community/rules/index');
  },

  onNightToggle(e) {
    const nightMode = e.detail.value;
    this.setData({ nightMode });
    wx.setStorageSync(scopedKey('reading-prefs'), { fontIndex: this.data.readingFontIndex, nightMode });
  },

  onFontTap() {
    const labels = ['小', '标准', '大'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        this.setData({ readingFontIndex: res.tapIndex });
        wx.setStorageSync(scopedKey('reading-prefs'), {
          fontIndex: res.tapIndex,
          nightMode: this.data.nightMode,
        });
      },
    });
  },

  onClearCache() {
    wx.showModal({
      title: '清除本机缓存',
      content: '仅清理本机缓存，不会删除云端账号与内容。草稿也会被清除。',
      confirmText: '清除',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const { keys } = wx.getStorageInfoSync();
          keys.filter((key) => key.startsWith('hg:')).forEach((key) => wx.removeStorageSync(key));
          wx.showToast({ title: '已清理本机缓存', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: '清理未完成，请重试', icon: 'none' });
        }
      },
    });
  },

  onExport() {
    if (!this.data.capabilities.export) {
      wx.showModal({ title: '暂未开放', content: '数据导出功能尚未开放。', showCancel: false });
      return;
    }
    wx.showModal({
      title: '导出我的内容',
      content: '确认本人身份后会生成异步任务，完成后通过站内消息通知。导出内容不包含他人的私密信息。',
      confirmText: '提交申请',
      success: (res) => {
        if (res.confirm) wx.showToast({ title: '已提交，完成后会通知你', icon: 'none' });
      },
    });
  },

  onContact() {
    wx.showModal({
      title: '联系运营者',
      content: '运营主体、联系方式、处理目的、保存期限与权利申请渠道由社团在上线前补充填写。',
      showCancel: false,
    });
  },

  onDeleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销会停止展示你的内容，并按规定清理或依法必要保留数据。处理需要时间，结果会通知你。如果只是想撤回文集授权，不需要注销账号。',
      confirmText: '继续',
      confirmColor: '#A85648',
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '这一步不可撤销。确认提交注销申请？',
          confirmText: '提交申请',
          confirmColor: '#A85648',
          success: (second) => {
            if (second.confirm) wx.showToast({ title: '已提交，处理中', icon: 'none' });
          },
        });
      },
    });
  },
});
