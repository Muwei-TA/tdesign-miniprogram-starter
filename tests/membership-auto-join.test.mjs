import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function loadJoinPage(harness) {
  const source = read('pages/community/join/index.js')
    .replace(/import \{[\s\S]*?\} from '\.\.\/membership';/, 'const { fetchMyMembershipApplication, submitMembershipApplication } = __membership;')
    .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');
  let definition;
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    getApp: () => harness.app,
    __membership: harness.membership,
    __navigation: { navigateTo() {} },
    wx: {
      showToast: (value) => harness.toasts.push(value),
      showModal() {},
      switchTab() {},
    },
  });
  const page = {
    data: {
      ...definition.data,
      form: { ...definition.data.form, displayName: 'Test member', inviteCode: 'sample-code' },
      rulesAgreed: true,
      privacyAgreed: true,
    },
    setData(updates, callback) {
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'form.displayName' || key === 'form.inviteCode') {
          const field = key.slice('form.'.length);
          this.data.form = { ...this.data.form, [field]: value };
        } else {
          this.data[key] = value;
        }
      });
      if (callback) callback();
    },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') page[key] = value;
  });
  harness.page = page;
  return page;
}

function createHarness({ refreshes, submit, application = null }) {
  const listeners = new Map();
  const emitted = [];
  const toasts = [];
  const submitCalls = [];
  const eventBus = {
    on(name, callback) {
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
    },
    off(name, callback) {
      const callbacks = listeners.get(name);
      if (callbacks) callbacks.delete(callback);
    },
    emit(name, value) {
      emitted.push([name, value]);
      const callbacks = listeners.get(name) || [];
      callbacks.forEach((callback) => callback(value));
    },
  };
  const app = {
    globalData: { session: null },
    eventBus,
    async refreshSession() {
      const response = refreshes.shift();
      if (response && response.error) throw response.error;
      app.globalData.session = response;
      eventBus.emit('session-changed', response);
      return response;
    },
  };
  const membership = {
    async fetchMyMembershipApplication() {
      return typeof application === 'function' ? application() : application;
    },
    async submitMembershipApplication(payload) {
      submitCalls.push(payload);
      return submit(payload);
    },
  };
  const harness = { app, membership, toasts, emitted, submitCalls };
  harness.page = loadJoinPage(harness);
  return harness;
}

const visitor = {
  role: 'guest',
  memberStatus: 'none',
  user: { displayName: 'Test member' },
  club: { name: 'Test club', rulesVersion: 'v1.1' },
};
const active = {
  role: 'member',
  memberStatus: 'active',
  user: { displayName: 'Test member' },
  club: { name: 'Test club', rulesVersion: 'v1.1' },
};
const pending = { ...visitor, memberStatus: 'pending' };

const successfulJoin = createHarness({
  refreshes: [visitor, active],
  submit: async () => ({ state: 'active' }),
});
await successfulJoin.page.onLoad({ from: 'home' });
await successfulJoin.page.onSubmit();
assert.equal(successfulJoin.page.data.status, 'active');
assert.equal(successfulJoin.page.data.session.memberStatus, 'active');
assert.equal(successfulJoin.app.globalData.session.memberStatus, 'active');
assert.equal(successfulJoin.submitCalls.length, 1);
assert.ok(successfulJoin.emitted.some(([name, session]) => name === 'session-changed' && session.memberStatus === 'active'));

const refreshFailure = createHarness({
  refreshes: [visitor, { error: { kind: 'network' } }, active],
  submit: async () => ({ state: 'active' }),
});
await refreshFailure.page.onLoad({ from: 'my' });
await refreshFailure.page.onSubmit();
assert.equal(refreshFailure.page.data.status, 'uncertain');
assert.notEqual(refreshFailure.page.data.status, 'active', 'submit response alone must not fake active membership');
assert.match(refreshFailure.page.data.statusReason, /不要重复提交邀请码/);
await refreshFailure.page.onRefreshStatus();
assert.equal(refreshFailure.page.data.status, 'active', 'read-only retry can confirm the server session later');
assert.equal(refreshFailure.submitCalls.length, 1, 'status retry must not consume another invite');

const responseLost = createHarness({
  refreshes: [visitor, active],
  submit: async () => { throw { kind: 'timeout' }; },
});
await responseLost.page.onLoad({ from: 'topics' });
await responseLost.page.onSubmit();
assert.equal(responseLost.page.data.status, 'active', 'a lost submit response must reconcile against /session/me');
assert.equal(responseLost.app.globalData.session.memberStatus, 'active');
assert.equal(responseLost.submitCalls.length, 1);

const responseStillUnknown = createHarness({
  refreshes: [visitor, visitor, active],
  submit: async () => { throw { kind: 'timeout' }; },
});
await responseStillUnknown.page.onLoad({ from: 'my' });
await responseStillUnknown.page.onSubmit();
assert.equal(responseStillUnknown.page.data.status, 'uncertain');
assert.match(responseStillUnknown.page.data.statusReason, /不要重复提交邀请码/);
await responseStillUnknown.page.onRefreshStatus();
assert.equal(responseStillUnknown.page.data.status, 'active');
assert.equal(responseStillUnknown.submitCalls.length, 1, 'retrying an unknown outcome only re-reads the session');

const removedMember = createHarness({
  refreshes: [{ ...visitor, memberStatus: 'removed' }, { ...visitor, memberStatus: 'removed' }],
  submit: async () => ({ state: 'pending' }),
  application: { state: 'pending' },
});
await removedMember.page.onLoad({ from: 'club' });
removedMember.page.onPendingReapply();
await removedMember.page.onSubmit();
assert.equal(removedMember.page.data.status, 'pending');
assert.notEqual(removedMember.page.data.status, 'active');
assert.match(removedMember.page.data.statusMeta.desc, /被移除/);
assert.equal(removedMember.page.data.showPendingReapplyForm, false);
removedMember.page.onPendingReapply();
assert.equal(removedMember.page.data.showPendingReapplyForm, true, 'pending reapply action only expands the existing form');
assert.equal(removedMember.page.data.status, 'pending', 'opening the form must not change server membership status');
assert.equal(removedMember.submitCalls.length, 1, 'opening the form must not submit or consume another invite');

const invalidInvite = createHarness({
  refreshes: [visitor],
  submit: async () => { throw { kind: 'invalid_input', detail: { field: 'inviteCode' }, message: '邀请码无效或已过期' }; },
});
await invalidInvite.page.onLoad({ from: 'my' });
await invalidInvite.page.onSubmit();
assert.equal(invalidInvite.page.data.status, 'invalid_code');
assert.equal(invalidInvite.page.data.submitting, false);

const applicationCannotPromote = createHarness({
  refreshes: [visitor],
  submit: async () => ({ state: 'active' }),
  application: { state: 'active' },
});
await applicationCannotPromote.page.onLoad({ from: 'my' });
assert.equal(applicationCannotPromote.page.data.status, 'uncertain');
assert.notEqual(applicationCannotPromote.page.data.status, 'active');

const joinMarkup = read('pages/community/join/index.wxml');
assert.match(joinMarkup, /有效邀请码通过服务端验证后会直接加入/);
assert.match(joinMarkup, /验证邀请码并加入/);
assert.match(joinMarkup, /status === 'uncertain'[\s\S]*?重新确认状态/);
assert.match(joinMarkup, /wx:if="\{\{ status === 'pending' \|\| status === 'duplicate' \|\| status === 'uncertain' \}\}"/);
assert.match(joinMarkup, /status === 'pending' && showPendingReapplyForm/);
assert.doesNotMatch(joinMarkup, /加入需要管理员确认/);
assert.doesNotMatch(read('pages/community/club/index.js'), /管理员确认后，成员资格会在会话刷新时生效/);

console.log('OK: invite success uses refreshed server membership, uncertain submissions reconcile safely, and removed-member pending remains guarded');
