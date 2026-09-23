import { fetchTopics, submitTopic, toggleFollow, TOPIC_CATEGORIES } from '~/services/topics';
import { getSession } from '~/services/session';
import { navigateTo } from '~/utils/navigate';

Page({
  data: {
    categories: TOPIC_CATEGORIES,
    category: 'all',
    list: [],
    loading: true,
    stale: false,
    errorText: '',
    isMember: false,

    // 发起话题弹层
    createVisible: false,
    form: { title: '', description: '', category: 'life' },
    submitting: false,
  },

  onLoad() {
    const session = getSession();
    this.setData({ isMember: session.memberStatus === 'active' });
    this.loadTopics();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'topics' });
    }
  },

  onPullDownRefresh() {
    this.loadTopics().then(() => wx.stopPullDownRefresh());
  },

  async loadTopics() {
    this.setData({ loading: true, stale: false, errorText: '' });
    try {
      const data = await fetchTopics({ category: this.data.category });
      this.setData({ list: data.items || [], loading: false, stale: false, errorText: '' });
    } catch (err) {
      this.setData({
        loading: false,
        stale: this.data.list.length > 0,
        errorText: err.message || '加载失败',
      });
    }
  },

  onCategoryTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.category) return;
    this.setData({ category: value, list: [], stale: false, errorText: '' }, () => this.loadTopics());
  },

  onTopicTap(e) {
    navigateTo(`/pages/community/topic/index?id=${e.detail.id}`);
  },

  async onFollow(e) {
    const { id, next } = e.detail;
    const index = this.data.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.setData({ [`list[${index}].followed`]: next });
    try {
      await toggleFollow(id, next);
    } catch (err) {
      this.setData({ [`list[${index}].followed`]: !next });
      wx.showToast({ title: err.message || '操作未完成', icon: 'none' });
    }
  },

  onCreateOpen() {
    if (!this.data.isMember) {
      wx.showModal({
        title: '需要成员资格',
        content: '发起话题需要先加入文学社。',
        confirmText: '去了解',
        success: (res) => {
          if (res.confirm) navigateTo('/pages/community/join/index?from=topics');
        },
      });
      return;
    }
    this.setData({ createVisible: true });
  },

  onCreateClose() {
    this.setData({ createVisible: false });
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onFormCategory(e) {
    this.setData({ 'form.category': e.currentTarget.dataset.value });
  },

  async onCreateSubmit() {
    const { title, description, category } = this.data.form;
    if (!title.trim()) {
      wx.showToast({ title: '请填写话题名称', icon: 'none' });
      return;
    }
    // 同名话题由服务端引导参与，不创建重复项
    const duplicated = this.data.list.find((item) => item.title === title.trim());
    if (duplicated) {
      wx.showModal({
        title: '已有相同话题',
        content: '这个话题已经存在，去参与就好。',
        confirmText: '去参与',
        success: (res) => {
          if (res.confirm) {
            this.setData({ createVisible: false });
            navigateTo(`/pages/community/topic/index?id=${duplicated.id}`);
          }
        },
      });
      return;
    }

    this.setData({ submitting: true });
    try {
      await submitTopic({ title: title.trim(), description: description.trim(), category });
      this.setData({
        submitting: false,
        createVisible: false,
        form: { title: '', description: '', category: 'life' },
      });
      wx.showToast({ title: '已提交，等待管理员确认', icon: 'none' });
      this.loadTopics();
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '提交未完成', icon: 'none' });
    }
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=topics');
  },

  /** 空态按钮：成员发起话题，访客先了解社团 */
  onEmptyAction() {
    if (this.data.isMember) this.onCreateOpen();
    else this.onJoin();
  },

  onRetry() {
    this.loadTopics();
  },
});
