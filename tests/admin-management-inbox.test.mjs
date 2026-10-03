import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const managementSource = readFileSync(join(ROOT, 'pages/admin/management/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace("import { fetchInitialSession } from '~/services/session';", 'const { fetchInitialSession } = __sessions;')
  .replace(/import \{\n[\s\S]*?\n\} from '\.\.\/governance';/, 'const __governance = __services; const { acceptHandover, acceptRecovery, declineHandover, declineRecovery, fetchAccountHandovers, fetchAccountRecoveries, fetchAccountRecovery } = __governance;');

function createPage({ fetchInitialSession, fetchAccountHandovers, fetchAccountRecoveries, fetchAccountRecovery = async () => null } = {}) {
  let definition;
  const modals = [];
  const services = {
    fetchInitialSession,
    fetchAccountHandovers,
    fetchAccountRecoveries,
    fetchAccountRecovery,
    async acceptHandover() {},
    async acceptRecovery() {},
    async declineHandover() {},
    async declineRecovery() {},
  };
  vm.runInNewContext(managementSource, {
    Page(value) { definition = value; },
    __sessions: { fetchInitialSession: services.fetchInitialSession },
    __services: services,
    wx: { showModal(options) { modals.push(options); }, showToast() {} },
  });
  const context = {
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') context[key] = value;
  });
  return { definition, context, modals };
}

let sessionId = 'u-target';
const pageCalls = [];
const { definition, context, modals } = createPage({
  async fetchInitialSession() { return { user: { id: sessionId, displayName: '确认人' } }; },
  async fetchAccountHandovers({ cursor } = {}) {
    pageCalls.push(['handover', cursor || 'first']);
    return cursor
      ? { items: [{ id: 'handover-late', targetUserId: 'u-target', status: 'proposed', version: 2 }], nextCursor: null }
      : { items: [{ id: 'handover-first', targetUserId: 'u-target', status: 'proposed', version: 1 }], nextCursor: 'handover-page-2' };
  },
  async fetchAccountRecoveries({ cursor } = {}) {
    pageCalls.push(['recovery', cursor || 'first']);
    return cursor
      ? { items: [{ id: 'recovery-accepted', targetUserId: 'u-target', status: 'recovery_requested', acceptedAt: '2026-10-03T10:00:00.000Z', version: 2 }] }
      : { items: [{ id: 'recovery-first', targetUserId: 'u-target', status: 'recovery_requested', version: 1 }], nextCursor: 'recovery-page-2' };
  },
});
context.data.identity = '旧账号';
context.data.handovers = [{ id: 'old-account-item' }];
await definition.onLoad.call(context, { handoverId: 'handover-late' });
assert.deepEqual(pageCalls.sort((left, right) => String(left).localeCompare(String(right))), [
  ['handover', 'first'], ['handover', 'handover-page-2'],
  ['recovery', 'first'], ['recovery', 'recovery-page-2'],
].sort((left, right) => String(left).localeCompare(String(right))));
assert.equal(JSON.stringify(context.data.handovers.map((item) => item.id)), JSON.stringify(['handover-late']), 'a focus item on a later handover page remains reachable');
assert.equal(JSON.stringify(context.data.recoveries.map((item) => item.id)), JSON.stringify(['recovery-first', 'recovery-accepted']));
assert.ok(context.data.recoveries[1].acceptedAtText, 'accepted recovery rows retain their confirmation timestamp');
definition.onAcceptTap.call(context, { currentTarget: { dataset: { kind: 'recovery', id: 'recovery-accepted' } } });
assert.equal(modals.length, 0, 'a recovery already confirmed by the target cannot be accepted again');

const sourceWxml = readFileSync(join(ROOT, 'pages/admin/management/index.wxml'), 'utf8');
assert.match(sourceWxml, /已确认，等待平台复核/);
assert.match(sourceWxml, /item\.status === 'recovery_requested' && !item\.acceptedAt/);

const sessionIds = ['u-before', 'u-after'];
const switched = createPage({
  async fetchInitialSession() { return { user: { id: sessionIds.shift() || 'u-after', displayName: '账号' } }; },
  async fetchAccountHandovers() { return { items: [{ id: 'must-not-display', targetUserId: 'u-before' }] }; },
  async fetchAccountRecoveries() { return { items: [] }; },
});
await switched.definition.onLoad.call(switched.context, {});
assert.equal(switched.context.data.identity, '', 'a late inbox response is cleared if the account changed while it was loading');
assert.equal(JSON.stringify(switched.context.data.handovers), JSON.stringify([]));
assert.equal(JSON.stringify(switched.context.data.recoveries), JSON.stringify([]));
assert.match(switched.context.data.errorText, /账号已切换/);

const invalidCursor = createPage({
  async fetchInitialSession() { return { user: { id: 'u-cursor' } }; },
  async fetchAccountHandovers() { return { items: [], nextCursor: 42 }; },
  async fetchAccountRecoveries() { return { items: [] }; },
});
await invalidCursor.definition.onLoad.call(invalidCursor.context, {});
assert.match(invalidCursor.context.data.errorText, /分页游标无效/);
assert.equal(JSON.stringify(invalidCursor.context.data.handovers), JSON.stringify([]), 'invalid cursors fail closed without displaying partial pages');

let resolveHandovers;
let announcePageFetch;
const pageFetchStarted = new Promise((resolve) => { announcePageFetch = resolve; });
const delayed = createPage({
  async fetchInitialSession() { return { user: { id: 'u-delay' } }; },
  fetchAccountHandovers() {
    announcePageFetch();
    return new Promise((resolve) => { resolveHandovers = resolve; });
  },
  async fetchAccountRecoveries() { return { items: [] }; },
});
delayed.context.data.identity = '旧快照';
delayed.context.data.recoveries = [{ id: 'old-item' }];
const pendingLoad = delayed.definition.onLoad.call(delayed.context, {});
await pageFetchStarted;
delayed.definition.onUnload.call(delayed.context);
resolveHandovers({ items: [{ id: 'late-result', targetUserId: 'u-delay' }] });
await pendingLoad;
assert.equal(delayed.context.data.identity, '', 'unloaded-page requests cannot restore prior account identity');
assert.equal(JSON.stringify(delayed.context.data.recoveries), JSON.stringify([]), 'unloaded-page requests cannot restore prior account items');

sessionId = 'u-target';
console.log('OK: account inbox loads every page, finds later-page focus items, closes accepted recovery actions, and drops stale account results');
