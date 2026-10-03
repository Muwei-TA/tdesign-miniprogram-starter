import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'pages/admin/web-login/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace("import { fetchInitialSession } from '~/services/session';", 'const { fetchInitialSession } = __sessions;')
  .replace("import { approveWebLogin, fetchWebLoginInfo, rejectWebLogin } from '../governance';", 'const { approveWebLogin, fetchWebLoginInfo, rejectWebLogin } = __governance;')
  .replace("import { createWebLoginFlow, describeApprovalScope } from './helpers';", 'const { createWebLoginFlow, describeApprovalScope } = __helpers;')
  .replace('const app = getApp();', 'const app = __app;');

function loadLoginPage(fetchInitialSession) {
  let definition;
  const flow = {
    state: { id: '', info: null, status: 'idle', busy: false, error: '' },
    async scan() {
      this.state = { id: 'pair-1', info: { origin: 'https://admin.example', expiresAt: '2026-10-03T10:00:00.000Z' }, status: 'pending', busy: false, error: '' };
      return this.state;
    },
    async decide(decision) { this.state.status = decision === 'approve' ? 'approved' : 'rejected'; return this.state; },
    clear() { this.state = { id: '', info: null, status: 'idle', busy: false, error: '' }; return this.state; },
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    __sessions: { fetchInitialSession },
    __governance: { async fetchWebLoginInfo() {}, async approveWebLogin() {}, async rejectWebLogin() {} },
    __helpers: {
      createWebLoginFlow() { return flow; },
      describeApprovalScope(session) {
        const user = session && session.user;
        return { account: user ? `${user.displayName} · ${user.id}` : '', scope: `scope-${user && user.id}` };
      },
    },
    __app: { globalData: {} },
    wx: { showToast() {} },
  });
  const context = {
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') context[key] = value;
  });
  return { definition, context, flow };
}

const sessionsDuringScan = [
  { user: { id: 'u-old', displayName: '旧账号' } },
  { user: { id: 'u-new', displayName: '新账号' } },
];
const switchedWhileScanning = loadLoginPage(async () => sessionsDuringScan.shift());
await switchedWhileScanning.definition.onLoad.call(switchedWhileScanning.context);
assert.equal(switchedWhileScanning.context.data.identity, '旧账号 · u-old');
await switchedWhileScanning.definition.loadPairing.call(switchedWhileScanning.context, 'blacklight-admin:abcdefgh');
assert.equal(switchedWhileScanning.context.data.identity, '', 'a pairing result cannot be shown under a different account');
assert.equal(switchedWhileScanning.context.data.scopeText, '', 'the prior account scope is cleared when identity changes');
assert.equal(switchedWhileScanning.context.data.id, '');
assert.equal(switchedWhileScanning.context.data.status, 'idle');
assert.equal(switchedWhileScanning.flow.state.id, '', 'the unfinished pairing request is invalidated');

const sessionsOnReturn = [
  { user: { id: 'u-old', displayName: '旧账号' } },
  { user: { id: 'u-new', displayName: '新账号' } },
];
const returnedAfterSwitch = loadLoginPage(async () => sessionsOnReturn.shift());
await returnedAfterSwitch.definition.onLoad.call(returnedAfterSwitch.context);
returnedAfterSwitch.context.data.status = 'pending';
returnedAfterSwitch.context.data.id = 'old-pairing';
returnedAfterSwitch.context.data.origin = 'https://admin.example';
returnedAfterSwitch.context.data.scopeText = 'scope-u-old';
returnedAfterSwitch.definition.onShow.call(returnedAfterSwitch.context);
await returnedAfterSwitch.definition.onShow.call(returnedAfterSwitch.context);
assert.equal(returnedAfterSwitch.context.data.identity, '新账号 · u-new');
assert.equal(returnedAfterSwitch.context.data.scopeText, 'scope-u-new');
assert.equal(returnedAfterSwitch.context.data.id, '', 'a page return after account switching drops the previous pairing');
assert.equal(returnedAfterSwitch.context.data.status, 'idle');

console.log('OK: Web-login confirmation context is cleared and in-flight scans are discarded after account switching');
