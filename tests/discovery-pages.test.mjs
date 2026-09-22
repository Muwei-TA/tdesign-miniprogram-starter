import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const topic = read('pages/community/topic/index.js');
assert.match(topic, /fetchTopicDetail\(this\.data\.id\)/);
assert.match(topic, /topicId=\$\{encodeURIComponent\(this\.data\.id\)\}/);
assert.doesNotMatch(topic, /release\/index\?[^`]*identityMode/);
assert.doesNotMatch(topic, /release\/index\?[^`]*visibility/);
assert.match(topic, /topic\.status !== 'active'/);
assert.match(topic, /await toggleFollow/);

const anthology = read('pages/anthology/index.js');
assert.match(anthology, /getCapabilities\(\)\.anthology !== true/);
assert.match(anthology, /unavailable: true/);
assert.match(read('pages/anthology/index.wxml'), /文集暂未开放/);

const collection = read('pages/community/collection/index.js');
assert.match(collection, /getCapabilities\(\)\.anthology !== true/);
assert.match(collection, /fetchCollectionDetail\(this\.data\.id\)/);
assert.match(collection, /collectionId=\$\{encodeURIComponent\(collection\.id\)\}/);
assert.match(read('pages/community/collection/index.wxml'), /投稿需要单独勾选授权/);

const profileService = read('services/profiles.js');
assert.match(profileService, /profile\/\$\{encodeURIComponent\(targetUserId\)\}/);
assert.match(profileService, /method: 'PATCH'/);
assert.match(profileService, /displayName/);
const profilePage = read('pages/community/profile/index.js');
assert.match(profilePage, /fetchProfile\(this\.data\.userId\)/);
assert.doesNotMatch(profilePage, /nextCursor|loadMore|onReachBottom/);
assert.match(read('pages/community/profile/index.wxml'), /匿名、私密或当前无权查看/);

const infoEdit = read('pages/my/info-edit/index.js');
assert.match(infoEdit, /updateMyProfile\(name\)/);
assert.match(infoEdit, /await bootstrapSession\(\)/);
assert.doesNotMatch(infoEdit, /wx\.chooseMedia/);
assert.match(read('pages/my/info-edit/index.wxml'), /头像上传暂未开放/);

const identity = read('components/identity-label/index.js');
assert.match(identity, /if \(isAnonymous\)/);
assert.match(identity, /triggerEvent\('explain'\)/);
assert.match(identity, /triggerEvent\('tapname'/);
const media = read('components/media-preview/index.js');
assert.match(media, /slice\(0, 9\)/);
assert.match(read('components/media-preview/index.wxml'), /正在处理，完成后才会展示/);
const requestState = read('components/request-state/index.wxml');
assert.match(requestState, /state === 'error'/);
assert.match(requestState, /state === 'loading'/);
assert.match(requestState, /state === 'empty'/);

console.log('OK: discovery routes, capability gates, profile privacy, and T-02 component contracts passed');
