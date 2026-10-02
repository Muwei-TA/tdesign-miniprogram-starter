import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const topic = read('pages/community/topic/index.js');
assert.match(topic, /fetchTopicDetail\(this\.data\.id,/);
assert.match(topic, /topicId=\$\{encodeURIComponent\(this\.data\.id\)\}/);
assert.doesNotMatch(topic, /release\/index\?[^`]*identityMode/);
assert.doesNotMatch(topic, /release\/index\?[^`]*visibility/);
assert.match(topic, /topic\.status !== 'active'/);
assert.match(topic, /await toggleFollow/);

const manuscript = read('pages/anthology/index.js');
assert.match(manuscript, /fetchFeed\(\{[\s\S]*filter: 'article'/);
assert.match(read('pages/anthology/index.wxml'), /mode="article"/);
assert.match(read('app.json'), /"text": "文稿"/);
const releaseMarkup = read('pages/release/index.wxml');
assert.match(releaseMarkup, /title="\{\{ mode === 'article' \? '写文稿' : '写一笔' \}\}"/);
assert.match(releaseMarkup, /placeholder="给这篇文稿一个标题"/);
assert.match(releaseMarkup, /\n\s+文稿\n/);

const membershipPrompts = [];
let releasePage;
const releaseSource = read('pages/release/index.js').replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
vm.runInNewContext(releaseSource, {
  Page: (definition) => { releasePage = definition; },
  getApp: () => ({ eventBus: { on() {}, off() {} } }),
  wx: { showModal: (options) => membershipPrompts.push(options) },
  LIMITS: { imageCount: 6 },
});
const releaseContext = Object.create(releasePage);
releaseContext.data = { ...releasePage.data };
releaseContext.setData = (patch, callback) => {
  Object.assign(releaseContext.data, patch);
  if (callback) callback();
};
releaseContext.pageOptions = { mode: 'article' };
releaseContext.promptMembership();
assert.equal(membershipPrompts[0].content, '写文稿需要先加入当前社团。');
releaseContext.joinPrompted = false;
releaseContext.pageOptions = { mode: 'fragment' };
releaseContext.promptMembership();
assert.equal(membershipPrompts[1].content, '写一笔需要先加入当前社团。');

const feedCalls = [];
const previewCalls = [];
const navigations = [];
const actionSheets = [];
const modals = [];
const shrinkCalls = [];
const deleteCalls = [];
const feedReplies = [
  {
    items: [{
      id: 'article-1',
      version: 4,
      visibility: 'club',
      status: 'published',
      author: { isAnonymous: false, displayName: '测试作者', userId: 'author-1' },
      viewer: {
        isOwner: true,
        canShrinkVisibility: true,
        canDelete: true,
        canComment: false,
        reacted: false,
        bookmarked: false,
      },
      counters: { reactions: 0, comments: 2 },
      media: { type: 'image', images: ['signed-first', 'signed-second'] },
    }],
    nextCursor: 'cursor-2',
  },
  { items: [{ id: 'article-2', media: { type: 'none' } }], nextCursor: null },
];
let manuscriptPage;
const manuscriptApp = {
  eventBus: { on() {}, off() {}, emit() {} },
};
const manuscriptSource = manuscript.replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
vm.runInNewContext(manuscriptSource, {
  Page: (definition) => { manuscriptPage = definition; },
  getApp: () => manuscriptApp,
  getSession: () => ({ memberStatus: 'active', capabilities: { publishing: true } }),
  getCapabilities: () => ({ publishing: true }),
  fetchFeed: async (input) => {
    feedCalls.push(input);
    return feedReplies.shift();
  },
  toggleReaction: async () => {},
  toggleBookmark: async () => {},
  shrinkVisibility: async (...args) => shrinkCalls.push(args),
  deletePost: async (...args) => deleteCalls.push(args),
  previewPostImage: (...args) => previewCalls.push(args),
  navigateTo: (url) => navigations.push(url),
  wx: {
    showToast() {},
    stopPullDownRefresh() {},
    showActionSheet: (options) => actionSheets.push(options),
    showModal: (options) => modals.push(options),
  },
});
const manuscriptContext = Object.create(manuscriptPage);
manuscriptContext.data = { ...manuscriptPage.data, list: [], isMember: true };
manuscriptContext.setData = (patch, callback) => {
  Object.assign(manuscriptContext.data, patch);
  if (callback) callback();
};
await manuscriptContext.loadFeed();
assert.equal(feedCalls[0].filter, 'article');
assert.equal(feedCalls[0].cursor, '');
assert.equal(manuscriptContext.data.list[0].media.images.length, 1);
assert.equal(manuscriptContext.data.list[0].media.images[0], 'signed-first');
assert.equal(manuscriptContext.data.hasMore, true);
const articlePost = manuscriptContext.data.list[0];

await manuscriptContext.loadFeed({ append: true });
assert.equal(feedCalls[1].filter, 'article');
assert.equal(feedCalls[1].cursor, 'cursor-2');
assert.deepEqual(Array.from(manuscriptContext.data.list, (item) => item.id), ['article-1', 'article-2']);
manuscriptContext.onTapMedia({ detail: { id: 'article-1', index: 0, type: 'image' } });
assert.deepEqual(previewCalls[0], ['article-1', 0]);
manuscriptContext.syncSession({ memberStatus: 'active', club: { id: 'club-a' }, capabilities: { publishing: true } });
manuscriptContext.onWriteArticle();
assert.equal(navigations[0], '/pages/release/index?mode=article');

manuscriptContext.data.list = [articlePost];
manuscriptContext.onMore({ detail: { id: 'article-1' } });
assert.deepEqual(Array.from(actionSheets[0].itemList), ['缩小可见范围', '删除']);
actionSheets[0].success({ tapIndex: 0 });
assert.equal(manuscriptContext.data.scopeVisible, true);
manuscriptContext.onScopeChange({ detail: { value: 'private' } });
await modals[0].success({ confirm: true });
assert.deepEqual(shrinkCalls[0], ['article-1', 'private', 4]);
assert.equal(manuscriptContext.data.list.length, 0);

manuscriptContext.data.list = [articlePost];
manuscriptContext.onMore({ detail: { id: 'article-1' } });
actionSheets[1].success({ tapIndex: 1 });
await modals[1].success({ confirm: true });
assert.deepEqual(deleteCalls[0], ['article-1', 4]);
assert.equal(manuscriptContext.data.list.length, 0);

const collection = read('pages/community/collection/index.js');
assert.match(collection, /getCapabilities\(\)\.anthology !== true/);
assert.match(collection, /fetchCollectionDetail\(this\.data\.id\)/);
assert.match(collection, /collectionId=\$\{encodeURIComponent\(collection\.id\)\}/);
assert.match(read('pages/community/collection/index.wxml'), /投稿需要单独勾选授权/);

const profileService = read('pages/community/profile-service.js');
const infoEditService = read('pages/my/info-edit/profile-service.js');
assert.match(profileService, /profile\/\$\{encodeURIComponent\(targetUserId\)\}/);
assert.match(infoEditService, /method: 'PATCH'/);
assert.match(infoEditService, /displayName/);
const profilePage = read('pages/community/profile/index.js');
assert.match(profilePage, /fetchProfile\(this\.data\.userId,/);
assert.match(read('pages/community/profile/index.wxml'), /匿名、私密或当前无权查看/);

const infoEdit = read('pages/my/info-edit/index.js');
assert.match(infoEdit, /updateMyProfile\(name\)/);
assert.match(infoEdit, /this\.syncSession\(getSession\(\)\)/);
assert.doesNotMatch(infoEdit, /bootstrapSession/);
assert.doesNotMatch(infoEdit, /wx\.chooseMedia/);
assert.match(read('pages/my/info-edit/index.wxml'), /头像上传暂未开放/);

const identity = read('components/identity-label/index.js');
assert.match(identity, /if \(isAnonymous\)/);
assert.match(identity, /triggerEvent\('explain'\)/);
assert.match(identity, /triggerEvent\('tapname'/);
const requestState = read('components/request-state/index.wxml');
assert.match(requestState, /state === 'error'/);
assert.match(requestState, /state === 'loading'/);
assert.match(requestState, /state === 'empty'/);

console.log('OK: article feed, pagination, image reauthorization, article publishing, collection gate, profile privacy, and T-02 contracts passed');
