import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = (value) => JSON.parse(JSON.stringify(value));
const calls = [];

const serviceSource = readFileSync(join(ROOT, 'services/governance.js'), 'utf8')
  .replace("import request, { withPath, withQuery } from '~/api/request';", 'const request = __request; const withPath = __withPath; const withQuery = __withQuery;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace('export default {', 'const __default = {');

const endpoints = {
  adminMembers: '/admin/members',
  adminMemberRemove: '/admin/members/:targetUserId/remove',
  adminMemberMute: '/admin/members/:targetUserId/mute',
  adminMemberRole: '/admin/members/:targetUserId/role',
  adminInvites: '/admin/invites',
  myAppeals: '/appeals/mine',
  appeals: '/appeals',
  adminAppeals: '/admin/appeals',
  adminAppealDecision: '/admin/appeals/:appealId/decision',
};
const withPath = (template, params = {}) => Object.keys(params).reduce(
  (url, key) => url.replace(`:${key}`, encodeURIComponent(params[key])),
  template,
);
const withQuery = (url, query = {}) => {
  const pairs = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return pairs.length ? `${url}?${pairs.join('&')}` : url;
};
const request = (url, options = {}) => {
  calls.push({ url, options });
  if (url.startsWith('/admin/members?')) {
    return Promise.resolve({
      items: [{
        targetUserId: 'u-1', displayName: '成员一', role: 'member', status: 'active', mutedUntil: null, version: 2,
        wxOpenIdRef: 'openid-must-not-cross',
      }],
    });
  }
  if (url.startsWith('/appeals/')) {
    return Promise.resolve({
      items: [{
        appealId: 'a-1', postId: 'p-1', contentVersion: 3, status: 'submitted', reason: '请复核', version: 1,
        body: 'private body', ownerId: 'private-owner',
      }],
    });
  }
  return Promise.resolve({ ok: true, code: 'AB12CD34EF56' });
};

const module = { exports: {} };
vm.runInNewContext(
  `${serviceSource}\nmodule.exports = { normalizeMember, normalizeMembers, normalizeAppeal, normalizeAppeals, fetchMembers, removeMember, muteMember, changeMemberRole, createInvite, fetchMyAppeals, fetchAdminAppeals, createAppeal, decideAppeal };`,
  {
    module,
    exports: module.exports,
    __request: request,
    __withPath: withPath,
    __withQuery: withQuery,
    __endpoints: endpoints,
    encodeURIComponent,
  },
);

const governance = module.exports;
const member = governance.normalizeMember({
  targetUserId: 'u-1', displayName: '成员一', role: 'member', status: 'active', version: 2, wxOpenIdRef: 'secret',
});
assert.deepEqual(plain(member), {
  targetUserId: 'u-1', displayName: '成员一', role: 'member', roleText: '成员', status: 'active', statusText: '正常', mutedUntil: null, version: 2,
});
const appeal = governance.normalizeAppeal({
  appealId: 'a-1', postId: 'p-1', contentVersion: 3, status: 'submitted', reason: '请复核', version: 1,
  body: 'private body', ownerId: 'private-owner',
});
assert.equal(appeal.body, undefined);
assert.equal(appeal.ownerId, undefined);

await governance.fetchMembers({ limit: 100 });
assert.equal(calls[0].url, '/admin/members?limit=100');
await governance.removeMember('u-1', 2, '理由');
await governance.muteMember('u-1', 3, null, '解除');
await governance.changeMemberRole('u-1', 4, 'moderator', '轮值');
await governance.createInvite({ maxUses: 2, ttlSeconds: 3600 });
await governance.fetchMyAppeals({ limit: 20 });
await governance.fetchAdminAppeals({ limit: 20 });
await governance.createAppeal({ postId: 'p-1', contentVersion: 3, reason: '请复核' });
await governance.decideAppeal('a-1', { expectedVersion: 1, decision: 'approve', reason: '批准并重新待审' });
assert.deepEqual(calls.slice(1).map((call) => call.url), [
  '/admin/members/u-1/remove',
  '/admin/members/u-1/mute',
  '/admin/members/u-1/role',
  '/admin/invites',
  '/appeals/mine?limit=20',
  '/admin/appeals?limit=20',
  '/appeals',
  '/admin/appeals/a-1/decision',
]);
assert.equal(calls[4].options.data.ttlSeconds, 3600);
assert.equal(calls[7].options.data.contentVersion, 3);
assert.equal(calls[8].options.data.decision, 'approve');

const membersPage = readFileSync(join(ROOT, 'pages/admin/members/index.js'), 'utf8');
const adminAppealsPage = readFileSync(join(ROOT, 'pages/admin/appeals/index.js'), 'utf8');
const communityAppealsPage = readFileSync(join(ROOT, 'pages/community/appeals/index.js'), 'utf8');
const communityAppealsWxml = readFileSync(join(ROOT, 'pages/community/appeals/index.wxml'), 'utf8');
const adminPage = readFileSync(join(ROOT, 'pages/admin/index.js'), 'utf8');
assert.match(membersPage, /member\.isSelf/);
assert.match(membersPage, /请填写处理理由/);
assert.match(membersPage, /actionBusy/);
assert.doesNotMatch(membersPage, /wxOpenIdRef|openid/);
assert.match(adminAppealsPage, /批准并重新待审/);
assert.match(adminAppealsPage, /expectedVersion: appeal\.version/);
assert.match(communityAppealsPage, /请填写申诉理由/);
assert.match(communityAppealsPage, /contentVersion/);
assert.match(communityAppealsPage, /submitting/);
assert.match(communityAppealsPage, /onMyContent/);
assert.match(communityAppealsPage, /pages\/community\/my-content\/index\?tab=pending/);
assert.match(communityAppealsWxml, /请从我的内容选择需要申诉的条目/);
assert.match(communityAppealsWxml, /bindtap="onMyContent"/);
assert.doesNotMatch(communityAppealsWxml, /内容 ID|内容版本|工单 v/);
assert.doesNotMatch(communityAppealsWxml, /hidden\/rejected/);
assert.match(communityAppealsWxml, /item\.statusText/);
assert.match(communityAppealsWxml, /申诉：\{\{ item\.reason \}\}/);
assert.match(adminPage, /pages\/admin\/members\/index/);
assert.match(adminPage, /pages\/admin\/appeals\/index/);

console.log('OK: governance DTO allow-lists, endpoint services, reason guards, and page contracts passed');
