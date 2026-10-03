import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = readFileSync(join(ROOT, 'pages/release/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace("import { submitPost } from '~/services/posts';", 'const { submitPost } = __posts;')
  .replace("import { fetchBoards } from '~/services/boards';", 'const { fetchBoards } = __boards;')
  .replace("import { saveDraft, getDraft, removeDraft } from './drafts';", 'const { saveDraft, getDraft, removeDraft } = __drafts;')
  .replace("import { bootstrapSession } from '~/services/session';", 'const { bootstrapSession } = __session;')
  .replace(
    "import {\n  IMAGE_STATUS,\n  LIMITS,\n  normalizeImageItem,\n  prepareImageFiles,\n  uploadImages,\n  validateImages,\n} from './uploads';",
    'const { IMAGE_STATUS, LIMITS, normalizeImageItem, prepareImageFiles, uploadImages, validateImages } = __uploads;',
  )
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

function createHarness({ uploadImages = async (images) => images } = {}) {
  let definition;
  let session = {
    user: { id: 'user-1' },
    role: 'member',
    memberStatus: 'active',
    club: { id: 'club-a' },
    capabilities: { publishing: true, uploads: true },
  };
  const listeners = {};
  const saves = [];
  const submissions = [];
  const app = {
    globalData: { session, clubSwitching: false },
    eventBus: {
      on(name, listener) { listeners[name] = listener; },
      off() {},
      emit() {},
    },
  };
  vm.runInNewContext(pageSource, {
    Page(page) { definition = page; },
    getApp: () => app,
    __posts: {
      async submitPost(payload, idempotencyKey) {
        submissions.push({ payload, idempotencyKey });
        return { id: `post-${submissions.length}`, state: 'pending' };
      },
    },
    __boards: { async fetchBoards() { return { items: [], nextCursor: null }; } },
    __drafts: {
      saveDraft(draft) {
        saves.push({ ...draft });
        return { ...draft, id: draft.id || `draft-${draft.clubId}`, idempotencyKey: draft.idempotencyKey || `key-${draft.clubId}` };
      },
      getDraft(id) {
        return id === 'draft-a' ? {
          id,
          idempotencyKey: 'key-a',
          kind: 'fragment',
          title: '',
          body: '已保存的 A 草稿',
          images: [],
          visibility: 'club',
          identityMode: 'named',
          commentsEnabled: true,
          topic: { id: 'topic-a', title: 'A 话题' },
          board: { id: 'board-a', title: 'A 板块' },
          collectionId: 'collection-a',
          consentGranted: true,
          video: null,
          clubId: 'club-a',
        } : null;
      },
      removeDraft() {},
    },
    __session: { async bootstrapSession() {} },
    __uploads: {
      IMAGE_STATUS: { VERIFIED: 'verified' },
      LIMITS: { imageCount: 9 },
      normalizeImageItem: (item) => item,
      async prepareImageFiles(files) { return files; },
      uploadImages,
      validateImages: () => ({ ok: true }),
    },
    __navigation: { navigateTo() {} },
    wx: {
      showToast() {},
      showModal() {},
      redirectTo() {},
    },
    setTimeout,
    clearTimeout,
  });
  const page = Object.assign(Object.create(definition), {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  });
  function switchClub(clubId) {
    listeners['club-context-changing']();
    session = { ...session, club: { id: clubId } };
    app.globalData.session = session;
    listeners['session-changed'](session);
  }
  return { app, page, saves, submissions, listeners, switchClub };
}

test('club switches preserve the source draft and rebind a blank editor to each selected club', async () => {
  const harness = createHarness();
  const { page, saves, submissions, switchClub } = harness;
  page.onLoad({
    mode: 'fragment',
    topicId: 'topic-a',
    topicTitle: 'A 话题',
    boardId: 'board-a',
    boardTitle: 'A 板块',
    collectionId: 'collection-a',
    draftId: 'draft-a',
  });
  assert.equal(page.editorClubId, 'club-a');
  page.data.body = 'A 社团的最新草稿';
  page.data.previewVisible = true;
  page.data.boardPickerVisible = true;
  page.data.scopeVisible = true;

  switchClub('club-b');
  assert.equal(saves[0].clubId, 'club-a');
  assert.equal(saves[0].body, 'A 社团的最新草稿');
  assert.equal(page.editorClubId, 'club-b');
  assert.equal(page.data.draftId, '');
  assert.equal(page.data.topic, null);
  assert.equal(page.data.board, null);
  assert.equal(page.data.collectionId, '');
  assert.equal(page.data.body, '');
  assert.equal(page.data.consentGranted, false);
  assert.equal(page.data.previewVisible, false);
  assert.equal(page.data.boardPickerVisible, false);
  assert.equal(page.data.scopeVisible, false);

  switchClub('club-a');
  assert.equal(page.editorClubId, 'club-a');
  assert.equal(page.data.draftId, '');
  assert.equal(page.data.topic, null);
  assert.equal(page.data.board, null);
  assert.equal(page.data.collectionId, '');
  page.data.body = 'A 社团的新内容';
  await page.onSubmit();
  assert.equal(submissions.length, 1, 'the editor must submit in A instead of rejecting the stale stack');
  assert.equal(submissions[0].payload.topicId, '');
  assert.equal(submissions[0].payload.boardId, '');
  assert.equal(submissions[0].payload.collectionId, '');
});

test('an upload from the old club cannot overwrite the editor or upload control in the new club', async () => {
  const runs = [];
  const harness = createHarness({
    uploadImages(images, options) {
      return new Promise((resolve) => runs.push({ images, options, resolve }));
    },
  });
  const { page, switchClub } = harness;
  page.onLoad({});
  page.data.images = [{ key: 'image-a', localPath: '/tmp/a.jpg', status: 'local' }];
  const oldUpload = page.runImageUploads();
  const oldControl = page.uploadControl;

  switchClub('club-b');
  assert.equal(oldControl.canceled, true);
  page.data.images = [{ key: 'image-b', localPath: '/tmp/b.jpg', status: 'local' }];
  const newUpload = page.runImageUploads();
  const newControl = page.uploadControl;

  runs[0].options.onItemChange([{ key: 'image-a', assetId: 'asset-a', status: 'verified' }], 0);
  runs[0].resolve([{ key: 'image-a', assetId: 'asset-a', status: 'verified' }]);
  await oldUpload;
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.images)), [{ key: 'image-b', localPath: '/tmp/b.jpg', status: 'local' }]);
  assert.equal(page.uploadControl, newControl, 'finishing A must not clear B\'s active upload control');

  runs[1].resolve([{ key: 'image-b', assetId: 'asset-b', status: 'verified' }]);
  await newUpload;
  assert.equal(page.data.images[0].assetId, 'asset-b');
});

console.log('OK: release editor rebinds by club, preserves scoped drafts, and ignores stale upload results');
