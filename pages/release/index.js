import { submitPost } from '~/services/posts';
import { saveDraft, getDraft, removeDraft } from '~/services/drafts';
import { bootstrapSession } from '~/services/session';
import {
  IMAGE_STATUS,
  LIMITS,
  normalizeImageItem,
  prepareImageFiles,
  uploadImages,
  validateImages,
} from '~/services/uploads';
import { navigateTo } from '~/utils/navigate';

const app = getApp();

const MAX_FRAGMENT = 2000;
const MAX_ARTICLE = 20000;
const MAX_TITLE = 60;

function imagePath(item) {
  if (typeof item === 'string') return item;
  return item && (item.previewPath || item.localPath || item.url) ? item.previewPath || item.localPath || item.url : '';
}

Page({
  data: {
    mode: 'fragment', // fragment | article
    title: '',
    body: '',
    images: [],
    video: null,

    visibility: 'club', // 新建内容默认社内
    identityMode: 'named',
    commentsEnabled: true,
    topic: null,
    collectionId: '',
    consentGranted: false,

    scopeVisible: false,
    previewVisible: false,
    submitting: false,
    uploadPhase: '',
    uploadIndex: -1,

    session: null,
    sessionReady: false,
    canPublish: false,
    capabilities: { publicScope: false, video: false, publishing: false, uploads: false },
    draftId: '',
    idempotencyKey: '',
    bodyLimit: MAX_FRAGMENT,
    titleLimit: MAX_TITLE,
    previewText: '',
    imageLimit: LIMITS.imageCount,
  },

  onLoad(options) {
    this.pageOptions = options || {};
    this.onSessionChanged = (session) => this.applySession(session);
    app.eventBus.on('session-changed', this.onSessionChanged);
    if (app.globalData.session) this.applySession(app.globalData.session);
    else this.restoreSession();
  },

  onUnload() {
    if (this.uploadControl) this.uploadControl.canceled = true;
    app.eventBus.off('session-changed', this.onSessionChanged);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.persistDraft({ silent: true });
  },

  async restoreSession() {
    const session = await bootstrapSession();
    app.globalData.session = session;
    app.eventBus.emit('session-changed', session);
  },

  applySession(session) {
    if (!session) return;
    const capabilities = {
      publicScope: false,
      video: false,
      publishing: false,
      uploads: false,
      ...(session.capabilities || {}),
    };
    const canPublish = session.memberStatus === 'active' && capabilities.publishing === true;
    this.setData({ session, sessionReady: true, capabilities, canPublish }, () => {
      if (session.memberStatus !== 'active') {
        this.promptMembership();
        return;
      }
      if (!this.editorInitialized) this.initializeEditor(this.pageOptions);
    });
  },

  promptMembership() {
    if (this.joinPrompted) return;
    this.joinPrompted = true;
    wx.showModal({
      title: '需要成员资格',
      content: '写一笔需要先加入文学社。',
      confirmText: '去了解',
      cancelText: '返回',
      success: (res) => {
        if (res.confirm) navigateTo('/pages/community/join/index?from=release');
        else wx.navigateBack();
      },
    });
  },

  onJoin() {
    navigateTo('/pages/community/join/index?from=release');
  },

  onBackHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  initializeEditor(options = {}) {
    this.editorInitialized = true;
    const patch = { capabilities: this.data.capabilities };
    if (options.mode === 'article') patch.mode = 'article';
    if (options.topicId) patch.topic = { id: options.topicId, title: options.topicTitle || '已选择的话题' };
    if (options.collectionId) patch.collectionId = options.collectionId;

    if (options.draftId) {
      const draft = getDraft(options.draftId);
      if (draft) {
        Object.assign(patch, {
          draftId: draft.id,
          idempotencyKey: draft.idempotencyKey,
          mode: draft.kind === 'article' ? 'article' : 'fragment',
          title: draft.title || '',
          body: draft.body || '',
          images: (draft.images || []).map(normalizeImageItem),
          visibility: draft.visibility || 'club',
          identityMode: draft.identityMode || 'named',
          commentsEnabled: draft.commentsEnabled !== false,
          topic: draft.topic || null,
          collectionId: draft.collectionId || options.collectionId || '',
          consentGranted: !!draft.consentGranted,
          video: draft.video || null,
        });
        // 本地视频不跨会话保存，恢复时提示重新选择
        if (draft.video) {
          wx.showToast({ title: '草稿里的视频需要重新选择', icon: 'none', duration: 2600 });
        }
      }
    }

    this.setData(patch, () => this.refreshLimits());
  },

  onHide() {
    // 切后台时静默存草稿，避免误触丢失内容
    this.persistDraft({ silent: true });
  },

  refreshLimits() {
    const isArticle = this.data.mode === 'article';
    this.setData({ bodyLimit: isArticle ? MAX_ARTICLE : MAX_FRAGMENT }, () => this.refreshPreviewText());
  },

  refreshPreviewText() {
    const { identityMode, visibility } = this.data;
    const identityText = identityMode === 'anonymous' ? '树洞身份' : '你的昵称';
    const scopeText = {
      public: '公开可见：任何打开本小程序的人都可能看到',
      club: '仅社内可见：只有当前有效成员能看到',
      private: '只有自己可见：不进入社区流、话题、搜索与互动',
    }[visibility];
    const tail = visibility === 'private' ? '保存后只留给自己。' : '提交后会先进入审核。';
    this.setData({ previewText: `你将以「${identityText}」发布，${scopeText}。${tail}` });
  },

  onModeTap(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.mode) return;
    // 长文改碎片时超限先提示，不截断内容
    if (value === 'fragment' && this.data.body.length > MAX_FRAGMENT) {
      wx.showModal({
        title: '内容较长',
        content: `碎片最多 ${MAX_FRAGMENT} 字。当前内容会保留，但需要精简后才能以碎片提交。`,
        showCancel: false,
      });
    }
    this.setData({ mode: value }, () => this.refreshLimits());
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onBodyInput(e) {
    this.setData({ body: e.detail.value });
    this.scheduleAutoSave();
  },

  /** 输入停止 1.5s 自动存草稿 */
  scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.persistDraft({ silent: true }), 1500);
  },

  onChooseImage() {
    if (this.data.submitting) return;
    if (this.data.capabilities.uploads !== true) {
      wx.showModal({
        title: '图片暂未开放',
        content: '图片上传和内容审核链路尚未验收完成。当前可以先保存纯文字草稿。',
        showCancel: false,
      });
      return;
    }
    if (this.data.video) {
      wx.showToast({ title: '图片与视频只能选一种', icon: 'none' });
      return;
    }
    const remaining = LIMITS.imageCount - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: `一条内容最多 ${LIMITS.imageCount} 张图片`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      success: async (res) => {
        const files = res.tempFiles || [];
        const check = validateImages(files, this.data.images.length, { allowCompression: true });
        if (!check.ok) {
          wx.showToast({ title: check.message, icon: 'none' });
          return;
        }
        try {
          const prepared = await prepareImageFiles(files, this.data.images.length);
          const images = this.data.images.concat(prepared);
          this.setData({ images }, () => this.persistDraft({ silent: true }));
        } catch (err) {
          wx.showToast({ title: err.message || '图片无法处理，请重新选择', icon: 'none' });
        }
      },
      fail: (err) => {
        if (!/cancel/i.test(String(err && (err.errMsg || err.message)))) {
          wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
        }
      },
    });
  },

  onChooseVideo() {
    if (!this.data.capabilities.video) {
      wx.showModal({
        title: '视频暂未开放',
        content: '视频的上传、转码与内容审核链路尚未验收完成，暂时不能发布视频。',
        showCancel: false,
      });
      return;
    }
    wx.showToast({ title: '视频上传链路待接入（T-15）', icon: 'none' });
  },

  onRemoveImage(e) {
    if (this.data.submitting) return;
    const { index } = e.currentTarget.dataset;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images }, () => this.persistDraft({ silent: true }));
  },

  onPreviewImage(e) {
    const { index } = e.currentTarget.dataset;
    const urls = this.data.images.map(imagePath).filter(Boolean);
    wx.previewImage({ current: imagePath(this.data.images[index]), urls });
  },

  onRetryImage(e) {
    if (this.data.submitting) return;
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.images[index]) return;
    if (this.data.images[index].retryable === false) {
      wx.showToast({ title: '请移除后重新选择这张图片', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    this.runImageUploads([index])
      .catch((err) => {
        wx.showToast({ title: err.message || '图片上传未完成', icon: 'none' });
      })
      .finally(() => this.setData({ submitting: false, uploadPhase: '' }));
  },

  onCancelUpload() {
    if (!this.data.submitting || !this.uploadControl) return;
    this.uploadControl.canceled = true;
  },

  async runImageUploads(indices = null) {
    if (this.data.capabilities.uploads !== true || this.data.images.length === 0) return this.data.images;
    this.uploadControl = { canceled: false };
    this.setData({ uploadPhase: 'media', uploadIndex: indices && indices.length ? indices[0] : -1 });
    try {
      const images = await uploadImages(this.data.images, {
        indices,
        control: this.uploadControl,
        pollIntervalMs: 1000,
        onItemChange: (next, index) => {
          this.setData({ images: next, uploadIndex: index }, () => this.persistDraft({ silent: true }));
        },
      });
      this.setData({ images, uploadPhase: '', uploadIndex: -1 }, () => this.persistDraft({ silent: true }));
      return images;
    } catch (err) {
      const images = err.items || this.data.images;
      this.setData({ images, uploadPhase: '', uploadIndex: err.index === undefined ? -1 : err.index }, () => {
        this.persistDraft({ silent: true });
      });
      throw err;
    } finally {
      this.uploadControl = null;
    }
  },

  onScopeOpen() {
    this.setData({ scopeVisible: true });
  },

  onScopeClose() {
    this.setData({ scopeVisible: false });
  },

  onScopeChange(e) {
    const { value } = e.detail;
    const patch = { visibility: value, scopeVisible: false };
    // 仅自己会取消公共话题关联与社区互动
    if (value === 'private') {
      patch.topic = null;
      patch.commentsEnabled = false;
    }
    this.setData(patch, () => this.refreshPreviewText());
  },

  onIdentityChange(e) {
    this.setData({ identityMode: e.detail.value ? 'anonymous' : 'named' }, () => this.refreshPreviewText());
  },

  onCommentsChange(e) {
    this.setData({ commentsEnabled: e.detail.value });
  },

  onIdentityExplain() {
    wx.showModal({
      title: '以树洞身份发布',
      content:
        '其他人看不到你的昵称与头像。这不是绝对匿名——具体经历、地名、班级、画面与文风仍可能让人猜到你。发布前可以再检查一遍。',
      showCancel: false,
      confirmText: '我知道了',
    });
  },

  onClearTopic() {
    this.setData({ topic: null });
  },

  onConsentChange(e) {
    this.setData({ consentGranted: e.detail.value });
  },

  /** 校验，返回错误文案或空字符串 */
  validate() {
    const { mode, title, body, images, collectionId, consentGranted, capabilities } = this.data;
    if (capabilities.publishing !== true) return '发布功能暂未开放';
    if (this.data.video && capabilities.video !== true) return '视频上传暂未开放，请移除视频后重试';
    if (images.length > 0 && capabilities.uploads !== true) return '图片上传暂未开放，请先移除图片或保存草稿';
    if (!body.trim() && images.length === 0 && !this.data.video) return '写一点内容，或者选一张图片';
    if (mode === 'article' && !title.trim()) return '文章需要一个标题';
    if (mode === 'article' && title.length > MAX_TITLE) return `标题请控制在 ${MAX_TITLE} 字内`;
    if (mode === 'article' && body.length > MAX_ARTICLE) return `文章正文最多 ${MAX_ARTICLE} 字`;
    if (mode === 'fragment' && body.length > MAX_FRAGMENT) return `碎片最多 ${MAX_FRAGMENT} 字，可以切换到文章`;
    if (collectionId && !consentGranted) return '向文集投稿需要先勾选授权';
    return '';
  },

  onPreviewOpen() {
    if (this.data.submitting) return;
    const error = this.validate();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }
    this.setData({ previewVisible: true });
  },

  onPreviewClose() {
    this.setData({ previewVisible: false });
  },

  persistDraft({ silent = false } = {}) {
    const {
      draftId,
      mode,
      title,
      body,
      images,
      visibility,
      identityMode,
      commentsEnabled,
      topic,
      collectionId,
      consentGranted,
      video,
      idempotencyKey,
    } = this.data;
    if (!body.trim() && !title.trim() && images.length === 0 && !video) return null;

    const draft = saveDraft({
      id: draftId,
      idempotencyKey,
      kind: mode,
      title,
      body,
      images,
      visibility,
      identityMode,
      commentsEnabled,
      topic,
      collectionId,
      consentGranted,
      video,
    });
    this.setData({ draftId: draft.id, idempotencyKey: draft.idempotencyKey });
    app.eventBus.emit('draft-changed', { draftId: draft.id });
    if (!silent) wx.showToast({ title: '已存草稿', icon: 'none' });
    return draft;
  },

  onSaveDraft() {
    const draft = this.persistDraft();
    if (!draft) {
      wx.showToast({ title: '还没有可保存的内容', icon: 'none' });
      return;
    }
    setTimeout(() => wx.navigateBack(), 600);
  },

  async onSubmit() {
    const error = this.validate();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    if (!this.data.canPublish) {
      wx.showToast({ title: '发布功能暂未开放', icon: 'none' });
      return;
    }

    // 幂等键随草稿持久化：超时重试时复用同一键，服务端保证只产生一条内容
    const draft = this.persistDraft({ silent: true });
    const idempotencyKey = (draft && draft.idempotencyKey) || this.data.idempotencyKey;

    this.setData({ submitting: true, uploadPhase: this.data.images.length ? 'media' : 'post', previewVisible: false });
    try {
      const { images: currentImages } = this.data;
      let images = currentImages;
      if (images.length > 0) {
        images = await this.runImageUploads();
        const pendingImage = images.find((image) => image.status !== IMAGE_STATUS.VERIFIED || !image.assetId);
        if (pendingImage) throw new Error(pendingImage.error || '图片仍在处理中，请稍后重试');
      }

      const payload = {
        kind: this.data.mode,
        title: this.data.title.trim(),
        body: this.data.body,
        assetIds: images.filter((image) => image.status === IMAGE_STATUS.VERIFIED).map((image) => image.assetId),
        visibility: this.data.visibility,
        identityMode: this.data.identityMode,
        topicId: this.data.topic ? this.data.topic.id : '',
        commentsEnabled: this.data.commentsEnabled,
        collectionId: this.data.collectionId,
        consentGranted: this.data.consentGranted,
      };
      const result = await submitPost(payload, idempotencyKey);

      if (this.data.draftId) removeDraft(this.data.draftId);
      app.eventBus.emit('post-created', { id: result.id, state: result.state });

      const query = `state=${result.state}&scope=${this.data.visibility}&identity=${this.data.identityMode}&id=${result.id}`;
      // redirectTo：返回栈不残留编辑器
      wx.redirectTo({ url: `/pages/community/result/index?${query}` });
    } catch (err) {
      this.setData({ submitting: false, uploadPhase: '' });
      this.persistDraft({ silent: true });
      wx.showModal({
        title: err.code === 'canceled' ? '上传已取消' : '提交未完成',
        content: `${err.message || '请稍后重试'}。内容已保存为草稿，可以稍后恢复。`,
        showCancel: false,
      });
    } finally {
      this.setData({ submitting: false, uploadPhase: '' });
    }
  },
});
