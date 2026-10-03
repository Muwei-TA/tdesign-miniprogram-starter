import Page from '~/utils/themed-page';
import { submitPost } from '~/services/posts';
import { fetchBoards } from '~/services/boards';
import { saveDraft, getDraft, removeDraft } from './drafts';
import {
  IMAGE_STATUS,
  LIMITS,
  normalizeImageItem,
  prepareImageFiles,
  uploadImages,
  validateImages,
} from './uploads';
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
    board: null,
    collectionId: '',
    consentGranted: false,

    scopeVisible: false,
    boardPickerVisible: false,
    boards: [],
    boardNextCursor: null,
    boardsLoading: false,
    boardsErrorText: '',
    previewVisible: false,
    submitting: false,
    uploadPhase: '',
    uploadIndex: -1,

    session: null,
    sessionReady: false,
    isBlackbox: false,
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
    this.onClubContextChanging = () => {
      if (this.editorClubId && this.editorClubId === (app.globalData.session
        && app.globalData.session.club && app.globalData.session.club.id)) {
        this.persistDraft({ silent: true });
      }
      if (this.uploadControl) this.uploadControl.canceled = true;
      this.uploadGeneration = (this.uploadGeneration || 0) + 1;
      this.submitRequestId = (this.submitRequestId || 0) + 1;
      this.retryUploadId = (this.retryUploadId || 0) + 1;
    };
    this.onClubSwitchFailed = () => {
      this.setData({ canPublish: !!this.editorClubId && this.data.session.memberStatus === 'active' });
    };
    app.eventBus.on('session-changed', this.onSessionChanged);
    app.eventBus.on('club-context-changing', this.onClubContextChanging);
    app.eventBus.on('club-switch-failed', this.onClubSwitchFailed);
    if (app.globalData.session) this.applySession(app.globalData.session);
    else this.restoreSession();
  },

  onUnload() {
    if (this.uploadControl) this.uploadControl.canceled = true;
    this.boardRequestId = (this.boardRequestId || 0) + 1;
    app.eventBus.off('session-changed', this.onSessionChanged);
    app.eventBus.off('club-context-changing', this.onClubContextChanging);
    app.eventBus.off('club-switch-failed', this.onClubSwitchFailed);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.persistDraft({ silent: true });
  },

  async restoreSession() {
    if (app.sessionInitialization) await app.sessionInitialization;
    const { session } = app.globalData;
    if (session && session.club) this.applySession(session);
    else navigateTo('/pages/community/clubs/index');
  },

  applySession(session) {
    if (!session) return;
    const nextClubId = session.club && session.club.id;
    const isBlackbox = nextClubId === 'blackbox-animation';
    let resetEditor = false;
    if (this.editorClubId && this.editorClubId !== nextClubId) {
      if (this.uploadControl) this.uploadControl.canceled = true;
      this.uploadGeneration = (this.uploadGeneration || 0) + 1;
      this.submitRequestId = (this.submitRequestId || 0) + 1;
      this.retryUploadId = (this.retryUploadId || 0) + 1;
      this.boardRequestId = (this.boardRequestId || 0) + 1;
      this.editorClubId = '';
      this.editorInitialized = false;
      // Deep links can carry A's draft/association into the editor. Preserve
      // the draft in A's scoped storage, then discard those options before B
      // gets an editor of its own.
      this.pageOptions = this.pageOptions && this.pageOptions.mode
        ? { mode: this.pageOptions.mode }
        : {};
      resetEditor = true;
      this.setData({
        draftId: '',
        idempotencyKey: '',
        title: '', body: '', images: [], video: null, topic: null, board: null, collectionId: '',
        consentGranted: false,
        previewVisible: false,
        boardPickerVisible: false,
        scopeVisible: false,
        boards: [], boardNextCursor: null, boardsLoading: false, boardsErrorText: '',
        submitting: false, uploadPhase: '',
      });
      wx.showToast({ title: '已切换社团，草稿保留在原社团', icon: 'none' });
    }
    const capabilities = {
      publicScope: false,
      video: false,
      publishing: false,
      uploads: false,
      ...(session.capabilities || {}),
    };
    const canPublish = session.memberStatus === 'active' && capabilities.publishing === true;
    this.setData({ session, sessionReady: true, isBlackbox, capabilities, canPublish }, () => {
      if (session.memberStatus !== 'active') {
        this.promptMembership();
        return;
      }
      if (!this.editorInitialized || resetEditor) this.initializeEditor(this.pageOptions);
    });
  },

  promptMembership() {
    if (this.joinPrompted) return;
    this.joinPrompted = true;
    const isArticle = this.pageOptions && this.pageOptions.mode === 'article';
    wx.showModal({
      title: '需要成员资格',
      content: isArticle
        ? '写文稿需要先加入当前社团。'
        : `${this.data.isBlackbox ? '发布作品' : '写一笔'}需要先加入当前社团。`,
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
    if (!this.data.session || !this.data.session.club || !this.data.session.club.id) return;
    this.editorInitialized = true;
    this.editorClubId = this.data.session.club && this.data.session.club.id;
    const patch = { capabilities: this.data.capabilities };
    if (options.mode === 'article') patch.mode = 'article';
    if (options.topicId) patch.topic = { id: options.topicId, title: options.topicTitle || '已选择的话题' };
    if (options.boardId) patch.board = { id: options.boardId, title: options.boardTitle || '已选择的板块' };
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
          board: draft.board || patch.board || null,
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
      private: '只有自己可见：不进入社区流、板块、话题、搜索与互动',
    }[visibility];
    let tail;
    if (visibility === 'private') {
      tail = '保存后只留给自己。';
    } else if (this.data.mode === 'article') {
      tail = '文章通过安全检查后会进入管理员审核，审核通过后按所选范围展示。';
    } else {
      tail = '普通帖子会先做自动安全检查，通过后直接展示；需要人工复核时会稍后通知。';
    }
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

  /** 输入停止 5s 自动存草稿 */
  scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.persistDraft({ silent: true }), 5000);
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
    const clubId = this.editorClubId;
    const retryUploadId = (this.retryUploadId || 0) + 1;
    this.retryUploadId = retryUploadId;
    const isCurrentRetry = () => this.retryUploadId === retryUploadId && this.editorClubId === clubId;
    this.setData({ submitting: true });
    this.runImageUploads([index])
      .catch((err) => {
        if (!isCurrentRetry()) return;
        wx.showToast({ title: err.message || '图片上传未完成', icon: 'none' });
      })
      .finally(() => {
        if (isCurrentRetry()) this.setData({ submitting: false, uploadPhase: '' });
      });
  },

  onCancelUpload() {
    if (!this.data.submitting || !this.uploadControl) return;
    this.uploadControl.canceled = true;
  },

  async runImageUploads(indices = null) {
    if (this.data.capabilities.uploads !== true || this.data.images.length === 0) return this.data.images;
    const clubId = this.editorClubId;
    const uploadControl = { canceled: false, clubId };
    const generation = (this.uploadGeneration || 0) + 1;
    this.uploadGeneration = generation;
    this.uploadControl = uploadControl;
    const isCurrentUpload = () => this.uploadControl === uploadControl
      && this.uploadGeneration === generation
      && this.editorClubId === clubId
      && this.data.session && this.data.session.club && this.data.session.club.id === clubId;
    this.setData({ uploadPhase: 'media', uploadIndex: indices && indices.length ? indices[0] : -1 });
    try {
      const images = await uploadImages(this.data.images, {
        indices,
        control: uploadControl,
        pollIntervalMs: 1000,
        onItemChange: (next, index) => {
          if (!isCurrentUpload()) return;
          this.setData({ images: next, uploadIndex: index }, () => this.persistDraft({ silent: true }));
        },
      });
      if (!isCurrentUpload()) return this.data.images;
      this.setData({ images, uploadPhase: '', uploadIndex: -1 }, () => this.persistDraft({ silent: true }));
      return images;
    } catch (err) {
      if (!isCurrentUpload()) return this.data.images;
      const images = err.items || this.data.images;
      this.setData({ images, uploadPhase: '', uploadIndex: err.index === undefined ? -1 : err.index }, () => {
        this.persistDraft({ silent: true });
      });
      throw err;
    } finally {
      if (this.uploadControl === uploadControl) this.uploadControl = null;
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
    // 仅自己不会进入公共板块或话题目录，也不接受社区互动。
    if (value === 'private') {
      patch.topic = null;
      patch.board = null;
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

  onBoardPickerOpen() {
    this.setData({ boardPickerVisible: true, boardsErrorText: '' });
    if (!this.boardChoicesLoaded) this.loadBoardChoices();
  },

  onBoardPickerClose() {
    this.setData({ boardPickerVisible: false });
  },

  onBoardPickerVisibleChange(e) {
    const detail = e && e.detail;
    const visible = typeof detail === 'boolean' ? detail : !!(detail && detail.visible);
    this.setData({ boardPickerVisible: visible });
  },

  async loadBoardChoices({ append = false } = {}) {
    if (this.data.boardsLoading) return;
    const cursor = append ? this.data.boardNextCursor : '';
    if (append && !cursor) return;
    const requestId = (this.boardRequestId || 0) + 1;
    this.boardRequestId = requestId;
    this.setData({
      boardsLoading: true,
      boardsErrorText: '',
      ...(append ? {} : { boardNextCursor: null }),
    });
    try {
      const data = await fetchBoards({ cursor, status: 'active' });
      if (requestId !== this.boardRequestId) return;
      const boards = append ? this.data.boards.concat(data.items || []) : data.items || [];
      this.boardChoicesLoaded = true;
      this.setData({
        boards,
        boardNextCursor: data.nextCursor || null,
        boardsLoading: false,
        boardsErrorText: '',
      });
    } catch (err) {
      if (requestId !== this.boardRequestId) return;
      this.setData({
        boardsLoading: false,
        boardsErrorText: err.message || '板块列表暂时无法读取',
      });
    }
  },

  onBoardRetryTap() {
    this.boardChoicesLoaded = false;
    return this.loadBoardChoices();
  },

  onBoardLoadMoreTap() {
    return this.loadBoardChoices({ append: true });
  },

  onBoardSelect(e) {
    const { id, title } = e.currentTarget.dataset;
    if (!id || !title) return;
    this.setData({ board: { id, title }, boardPickerVisible: false }, () => this.persistDraft({ silent: true }));
  },

  onBoardClear() {
    this.setData({ board: null }, () => this.persistDraft({ silent: true }));
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
    if (mode === 'article' && !title.trim()) return '文稿需要一个标题';
    if (mode === 'article' && title.length > MAX_TITLE) return `标题请控制在 ${MAX_TITLE} 字内`;
    if (mode === 'article' && body.length > MAX_ARTICLE) return `文稿正文最多 ${MAX_ARTICLE} 字`;
    if (mode === 'fragment' && body.length > MAX_FRAGMENT) return `碎片最多 ${MAX_FRAGMENT} 字，可以切换到文稿`;
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
      board,
      collectionId,
      consentGranted,
      video,
      idempotencyKey,
    } = this.data;
    if (!this.editorClubId || !this.data.session || !this.data.session.club
      || this.editorClubId !== this.data.session.club.id) return null;
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
      board,
      collectionId,
      consentGranted,
      video,
      clubId: this.editorClubId,
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
    if (!this.editorClubId || !app.globalData.session || !app.globalData.session.club
      || this.editorClubId !== app.globalData.session.club.id || app.globalData.clubSwitching) {
      wx.showToast({ title: '社团已切换，请回到当前社团重新编辑', icon: 'none' });
      return;
    }
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
    const clubId = this.editorClubId;
    const submitRequestId = (this.submitRequestId || 0) + 1;
    this.submitRequestId = submitRequestId;
    const isCurrentSubmission = () => this.submitRequestId === submitRequestId
      && this.editorClubId === clubId
      && app.globalData.session && app.globalData.session.club
      && app.globalData.session.club.id === clubId;

    // 幂等键随草稿持久化：超时重试时复用同一键，服务端保证只产生一条内容
    const draft = this.persistDraft({ silent: true });
    const idempotencyKey = (draft && draft.idempotencyKey) || this.data.idempotencyKey;

    this.setData({ submitting: true, uploadPhase: this.data.images.length ? 'media' : 'post', previewVisible: false });
    try {
      const { images: currentImages } = this.data;
      let images = currentImages;
      if (images.length > 0) {
        images = await this.runImageUploads();
        if (!isCurrentSubmission()) return;
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
        boardId: this.data.visibility === 'private' || !this.data.board ? '' : this.data.board.id,
        commentsEnabled: this.data.commentsEnabled,
        collectionId: this.data.collectionId,
        consentGranted: this.data.consentGranted,
      };
      const result = await submitPost(payload, idempotencyKey);
      if (!isCurrentSubmission()) return;

      if (this.data.draftId) removeDraft(this.data.draftId);
      app.eventBus.emit('post-created', { id: result.id, state: result.state });

      const query = `state=${result.state}&kind=${this.data.mode}&scope=${this.data.visibility}&identity=${this.data.identityMode}&id=${result.id}`;
      // redirectTo：返回栈不残留编辑器
      wx.redirectTo({ url: `/pages/community/result/index?${query}` });
    } catch (err) {
      if (!isCurrentSubmission()) return;
      this.setData({ submitting: false, uploadPhase: '' });
      this.persistDraft({ silent: true });
      wx.showModal({
        title: err.code === 'canceled' ? '上传已取消' : '提交未完成',
        content: `${err.message || '请稍后重试'}。内容已保存为草稿，可以稍后恢复。`,
        showCancel: false,
      });
    } finally {
      if (isCurrentSubmission()) this.setData({ submitting: false, uploadPhase: '' });
    }
  },
});
