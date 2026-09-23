import { fetchPostDetail, resubmitRejectedPost } from '~/services/posts';
import { bootstrapSession, scopedKey } from '~/services/session';
import { createIdempotencyKey } from '~/utils/idempotency';

function draftKey(id) {
  return scopedKey(`resubmit:${id}`);
}

Page({
  data: {
    id: '',
    loading: true,
    submitting: false,
    errorText: '',
    version: 0,
    kind: '',
    title: '',
    body: '',
    bodyLimit: 2000,
    mediaCount: 0,
    statusText: '',
    visibilityText: '',
    identityText: '',
    idempotencyKey: '',
  },

  async onLoad(options = {}) {
    const id = String(options.id || '');
    this.setData({ id });
    if (!id) {
      this.setData({ loading: false, errorText: '内容当前不可访问' });
      return;
    }
    try {
      const session = getApp().globalData.session || await bootstrapSession();
      if (!session.user || !session.user.id || session.memberStatus !== 'active') {
        this.setData({ loading: false, errorText: '需要有效成员资格才能重新提交' });
        return;
      }
      this.sessionUserId = session.user.id;
      this.onSessionChanged = (next) => {
        if (!next || !next.user || next.user.id !== this.sessionUserId || next.memberStatus !== 'active') {
          this.accountChanged = true;
          this.setData({ version: 0, title: '', body: '', errorText: '账号或成员资格已变化，请重新进入' });
        }
      };
      getApp().eventBus.on('session-changed', this.onSessionChanged);
      await this.loadPost();
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '会话暂时无法确认' });
    }
  },

  async loadPost() {
    if (this.accountChanged) return;
    this.setData({ loading: true, errorText: '' });
    try {
      const post = await fetchPostDetail(this.data.id);
      if (this.accountChanged) return;
      if (post.status !== 'rejected' || !post.viewer || !post.viewer.isOwner) {
        this.setData({ loading: false, errorText: '这条内容当前不能重新编辑' });
        return;
      }
      const saved = wx.getStorageSync(draftKey(this.data.id));
      const restore = saved && saved.version === post.version;
      this.setData({
        loading: false,
        version: post.version,
        kind: post.kind,
        title: restore ? saved.title : post.title || '',
        body: restore ? saved.body : post.body || '',
        bodyLimit: post.kind === 'article' ? 20000 : 2000,
        mediaCount: post.media ? post.media.count || 0 : 0,
        statusText: post.statusText || '需要修改',
        visibilityText: post.visibility === 'public' ? '公开可见' : '仅社内可见',
        identityText: post.identityMode === 'anonymous' ? '树洞身份' : '你的昵称',
        idempotencyKey: restore && saved.idempotencyKey ? saved.idempotencyKey : createIdempotencyKey('resubmit'),
      });
    } catch (err) {
      this.setData({ loading: false, errorText: err.message || '内容暂时无法读取' });
    }
  },

  onRetry() {
    this.loadPost();
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value, idempotencyKey: createIdempotencyKey('resubmit') }, () => this.saveDraft());
  },

  onBodyInput(e) {
    this.setData({ body: e.detail.value, idempotencyKey: createIdempotencyKey('resubmit') }, () => this.saveDraft());
  },

  saveDraft() {
    if (!this.data.id || !this.data.version || this.completed) return;
    wx.setStorageSync(draftKey(this.data.id), {
      version: this.data.version,
      title: this.data.title,
      body: this.data.body,
      idempotencyKey: this.data.idempotencyKey,
    });
  },

  onUnload() {
    if (this.onSessionChanged) getApp().eventBus.off('session-changed', this.onSessionChanged);
    this.saveDraft();
  },

  onSubmit() {
    if (this.data.loading || this.data.submitting || this.data.errorText) return;
    if (this.data.kind === 'article' && !this.data.title.trim()) {
      wx.showToast({ title: '文章需要一个标题', icon: 'none' });
      return;
    }
    if (!this.data.body.trim() && this.data.mediaCount === 0) {
      wx.showToast({ title: '写一点内容', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认重新提交',
      content: `仍以${this.data.identityText}发布，范围为${this.data.visibilityText}。原附件保持不变，提交后重新审核。`,
      confirmText: '提交审核',
      success: (res) => { if (res.confirm) this.submitConfirmed(); },
    });
  },

  async submitConfirmed() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await resubmitRejectedPost(this.data.id, {
        title: this.data.title.trim(),
        body: this.data.body,
        expectedVersion: this.data.version,
      }, this.data.idempotencyKey);
      if (this.accountChanged) return;
      this.completed = true;
      wx.removeStorageSync(draftKey(this.data.id));
      wx.redirectTo({
        url: `/pages/community/result/index?state=${result.state}&scope=${this.data.visibilityText === '公开可见' ? 'public' : 'club'}&identity=${this.data.identityText === '树洞身份' ? 'anonymous' : 'named'}&id=${encodeURIComponent(result.id)}`,
      });
    } catch (err) {
      this.saveDraft();
      wx.showModal({
        title: '提交未完成',
        content: `${err.message || '请稍后重试'}。编辑内容已保存在本机；如果刚才请求超时，请先刷新状态，再决定是否重试。`,
        showCancel: false,
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
