import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPageModule } from './helpers/page-module-loader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = process.env.BLACKLIGHT_BACKEND_WORKTREE
  || join(ROOT, '../blacklight-admin-governance-20261003');

function loadGlobalScript(path, globals = {}) {
  const sandbox = { ...globals };
  vm.runInNewContext(readFileSync(path, 'utf8'), sandbox, { filename: path });
  return sandbox;
}

function loadApiUrl(config) {
  const requestSource = readFileSync(join(ROOT, 'api/request.js'), 'utf8')
    .replace("import config from '~/config';", 'const config = __config;')
    .replace("import { resolveTransport, withIdempotency } from '~/api/transport';", 'const { resolveTransport, withIdempotency } = __transport;')
    .replace(/export class /g, 'class ')
    .replace('export default function request', 'function request')
    .replace(/export function /g, 'function ')
    .replace('export { DEFAULT_MESSAGE };', '')
    .concat('\nmodule.exports = { apiUrl };');
  const module = { exports: {} };
  vm.runInNewContext(requestSource, {
    module,
    exports: module.exports,
    __config: config,
    __transport: { resolveTransport() {}, withIdempotency(value) { return value; } },
  });
  return module.exports.apiUrl;
}

const core = loadGlobalScript(join(BACKEND_ROOT, 'admin-web/core.js'), { URL }).AdminCore;
const admin = { user: { id: 'u-admin' }, platformRole: 'none', clubs: [{ id: 'club-a', name: '社团甲', role: 'admin' }] };
const moderator = { ...admin, clubs: [{ id: 'club-a', name: '社团甲', role: 'moderator' }] };
const developer = { user: { id: 'u-dev' }, platformRole: 'developer', clubs: [] };
const ordinaryMember = { user: { id: 'u-member' }, platformRole: 'none', clubs: [{ id: 'club-a', role: 'member' }] };
assert.deepEqual(JSON.parse(JSON.stringify(core.visibleWorkspaces(admin, 'club-a').map((item) => item.id))), ['overview']);
assert.deepEqual(JSON.parse(JSON.stringify(core.visibleWorkspaces(moderator, 'club-a').map((item) => item.id))), [
  'overview', 'members', 'invites', 'settings', 'team', 'audit',
]);
assert.deepEqual(JSON.parse(JSON.stringify(core.visibleWorkspaces(developer, '').map((item) => item.id))), ['platform']);
assert.deepEqual(JSON.parse(JSON.stringify(core.visibleWorkspaces(ordinaryMember, 'club-a'))), []);

const expectedReviewQueueActions = {
  content: ['approve', 'reject', 'hide'],
  comment: ['approve', 'reject', 'hide'],
  topic: ['approve', 'archive', 'reject'],
  board: ['approve', 'reject'],
  member: ['approve', 'reject'],
  report: ['keep', 'hide', 'escalate'],
  collection: ['include', 'skip'],
  appeals: ['approve', 'reject'],
};
for (const [queue, keys] of Object.entries(expectedReviewQueueActions)) {
  const item = { queue, status: queue === 'appeals' ? 'submitted' : queue === 'report' ? 'received' : queue === 'collection' ? 'queued' : 'pending' };
  if (queue === 'content') item.kind = 'article';
  assert.deepEqual(JSON.parse(JSON.stringify(core.reviewActionsFor(item).map((action) => action.key))), keys);
}
assert.deepEqual(JSON.parse(JSON.stringify(core.reviewActionsFor({ queue: 'content', kind: 'article', status: 'published' }))), []);
assert.deepEqual(JSON.parse(JSON.stringify(core.reviewActionsFor({ queue: 'content', kind: 'unknown', status: 'pending' }))), []);
assert.equal(core.reviewActionsFor({ queue: 'appeals', status: 'submitted' })[0].requiresReason, true);
assert.equal(core.reviewActionsFor({ queue: 'appeals', status: 'submitted' })[0].maxReasonLength, 500);
assert.equal(core.reviewActionsFor({ queue: 'content', kind: 'fragment', status: 'pending' }).find((action) => action.key === 'approve').requiresReason, false);

const clubScope = core.createClubRequestScope('club-a');
const pendingClubAResponse = clubScope.begin();
clubScope.setClub('club-b');
assert.equal(clubScope.isCurrent(pendingClubAResponse), false, 'a response from the old club must not update the current view');
const currentClubBResponse = clubScope.begin();
assert.equal(clubScope.isCurrent(currentClubBResponse), true);

const pagedCandidates = await core.collectPagedItems(async ({ limit, cursor }) => {
  assert.equal(limit, 100);
  return cursor
    ? { items: [{ targetUserId: 'late-member', status: 'active', role: 'moderator' }] }
    : { items: Array.from({ length: 100 }, (_, index) => ({ targetUserId: `member-${index}`, status: 'active' })), nextCursor: 'page-2' };
});
assert.equal(pagedCandidates.complete, true);
assert.equal(pagedCandidates.items.length, 101, 'team view candidates include the second member page');
const mergedCandidates = core.activeTeamCandidates(pagedCandidates.items, [
  { targetUserId: 'late-manager', displayName: '末页负责人', status: 'active', role: 'moderator' },
  { targetUserId: 'removed-manager', status: 'removed', role: 'moderator' },
]);
assert.equal(mergedCandidates.length, 102, 'active current-team members omitted by the member page remain selectable');
assert.ok(mergedCandidates.some((member) => member.targetUserId === 'late-manager'));
assert.equal(core.retainableInvites([
  ...Array.from({ length: 106 }, (_, index) => ({ inviteId: `invite-${index}`, status: 'active', mode: 'application' })),
  { inviteId: 'direct', status: 'active', mode: 'direct' },
  { inviteId: 'revoked', status: 'revoked', mode: 'application' },
]).length, 106, 'all application invitations are eligible for cross-term retention');
const cursorCycle = await core.collectPagedItems(async () => ({ items: [], nextCursor: 'loop' }));
assert.equal(cursorCycle.complete, false);
assert.equal(cursorCycle.reason, 'cursor_cycle');
const invalidCursor = await core.collectPagedItems(async () => ({ items: [], nextCursor: 42 }));
assert.equal(invalidCursor.complete, false);
assert.equal(invalidCursor.reason, 'invalid_cursor');
const cursorCap = await core.collectPagedItems(async ({ limit }) => {
  assert.equal(limit, 100);
  return { items: [], nextCursor: 'more' };
}, { maxPages: 1 });
assert.equal(cursorCap.complete, false);
assert.equal(cursorCap.reason, 'page_limit');
let scopeCurrent = true;
const stalePage = await core.collectPagedItems(async () => {
  scopeCurrent = false;
  return { items: [{ targetUserId: 'old-club' }] };
}, { isCurrent: () => scopeCurrent });
assert.equal(stalePage.complete, false);
assert.equal(stalePage.reason, 'stale', 'a club change during a page request invalidates the response');

const expiredLogout = core.logoutFailureView({ status: 401, message: '请重新扫码登录' });
assert.equal(expiredLogout.view, 'login', 'a rejected expired logout returns to the QR login view');
assert.equal(expiredLogout.kind, 'expired');
const unavailableLogout = core.logoutFailureView({ status: 0, message: '网络暂时不可用' });
assert.equal(unavailableLogout.view, 'shell', 'non-401 logout failures keep the current shell');
assert.equal(unavailableLogout.message, '网络暂时不可用');
const expiredSessionState = {
  session: { user: { id: 'u-old' } }, clubId: 'club-a', platformClubId: 'club-platform', view: 'team',
  dataByView: { team: { members: ['stale-team'] }, invites: { items: ['stale-invite'] } },
  pagination: { team: { nextCursor: 'stale' } }, loadingView: true, viewError: 'stale error',
  banner: 'stale banner', bannerKind: 'error', oneTimeCode: 'secret-code', oneTimeInvite: { inviteId: 'i-old' },
};
core.clearExpiredSessionState(expiredSessionState);
assert.equal(expiredSessionState.session, null);
assert.equal(expiredSessionState.clubId, '');
assert.equal(expiredSessionState.platformClubId, '');
assert.equal(expiredSessionState.view, 'overview');
assert.equal(JSON.stringify(expiredSessionState.dataByView), JSON.stringify({}));
assert.equal(JSON.stringify(expiredSessionState.pagination), JSON.stringify({}));
assert.equal(expiredSessionState.loadingView, false);
assert.equal(expiredSessionState.viewError, '');
assert.equal(expiredSessionState.banner, '');
assert.equal(expiredSessionState.bannerKind, 'notice');
assert.equal(expiredSessionState.oneTimeCode, '');
assert.equal(expiredSessionState.oneTimeInvite, null);

const pairing = core.createPairingView({
  id: 'abcdefghijklmnopqrstuvwx',
  qrText: 'blacklight-admin:abcdefghijklmnopqrstuvwx',
  qrSvg: '<svg></svg>',
  expiresAt: '2026-10-03T05:00:00.000Z',
  pollKey: 'private-poll-key',
}, 'http://127.0.0.1:18884');
assert.equal(pairing.qrText, 'blacklight-admin:abcdefghijklmnopqrstuvwx');
assert.equal(pairing.pollKey, 'private-poll-key');
assert.equal(pairing.qrText.includes(pairing.pollKey), false);
assert.throws(() => core.createPairingView({ ...pairing, qrText: 'blacklight-admin:wrong-id' }, 'http://127.0.0.1:18884'));

const presenter = core.createOneTimeCodePresenter();
assert.equal(presenter.reveal('first-secret-code'), 'first-secret-code');
assert.equal(presenter.reveal('first-secret-code'), '', 'a code response can only be presented once');
presenter.clear();
assert.equal(presenter.value(), '', 'the raw code is cleared when the user leaves the view');
assert.equal(presenter.reveal('first-secret-code'), '', 'clearing a viewed code must not reveal the same response again');
assert.equal(core.createOneTimeCodePresenter().reveal('second-secret-code'), 'second-secret-code');

const browserApi = loadGlobalScript(join(BACKEND_ROOT, 'admin-web/api.js')).AdminApi;
const browserCalls = [];
const browserResponses = [
  { user: { id: 'u-mod', displayName: '负责人' }, platformRole: 'none', clubs: [{ id: 'club-a', role: 'moderator' }], csrfToken: 'csrf-in-memory' },
  { code: 0, data: { accepted: true } },
  { code: 0, data: { id: 'pair-1', qrText: 'blacklight-admin:pair-1', qrSvg: '<svg></svg>', expiresAt: '2026-10-03T05:00:00.000Z', pollKey: 'poll-secret' } },
  { code: 0, data: { status: 'pending' } },
];
const api = browserApi.createAdminApi(async (path, options) => {
  browserCalls.push({ path, options });
  return { ok: true, status: 200, json: async () => browserResponses.shift() };
});
await api.getSession();
await api.action('admin/invites/create', 'club-a', { mode: 'application', reason: '招新' });
const createdPairing = await api.createPairing();
await api.pairingStatus(createdPairing.id, createdPairing.pollKey);
assert.ok(browserCalls.every((call) => call.options.credentials === 'same-origin'));
assert.equal(browserCalls[1].options.headers['X-CSRF-Token'], 'csrf-in-memory');
assert.deepEqual(JSON.parse(browserCalls[1].options.body), {
  action: 'admin/invites/create', clubId: 'club-a', payload: { mode: 'application', reason: '招新' },
});
assert.deepEqual(JSON.parse(browserCalls[2].options.body), {});
assert.equal(browserCalls[3].path, '/v1/admin/auth/pairings/status');
assert.deepEqual(JSON.parse(browserCalls[3].options.body), { id: 'pair-1', pollKey: 'poll-secret' });
assert.equal(browserCalls[3].path.includes('poll-secret'), false, 'the QR poll key must not appear in a URL');
assert.throws(() => api.action('platform/private-content/read', '', {}));

const requestApiUrl = loadApiUrl({ profile: 'nasLocalDevelopment', transport: 'nas', apiBaseUrl: 'http://127.0.0.1:18884' });
assert.equal(requestApiUrl('/v1/action'), 'http://127.0.0.1:18884/v1/action');
for (const apiBaseUrl of ['http://127.0.0.1:18885', 'http://localhost:18884', 'http://192.168.50.28:18118']) {
  const invalidApiUrl = loadApiUrl({ profile: 'nasLocalDevelopment', transport: 'nas', apiBaseUrl });
  assert.throws(() => invalidApiUrl('/v1/action'), /服务配置暂不可用/);
}
const productionHttpApiUrl = loadApiUrl({ profile: 'nasProduction', transport: 'nas', apiBaseUrl: 'http://127.0.0.1:18884' });
assert.throws(() => productionHttpApiUrl('/v1/action'), /服务配置暂不可用/);

const webLogin = await loadPageModule(
  new URL('../pages/admin/web-login/helpers.js', import.meta.url),
  ['parseWebLoginQr', 'createWebLoginFlow', 'describeApprovalScope'],
);
assert.equal(webLogin.parseWebLoginQr('blacklight-admin:abcdefghijklmnopqrstuvwx'), 'abcdefghijklmnopqrstuvwx');
assert.equal(webLogin.parseWebLoginQr('blacklight-admin:abcdefghijklmnopqrstuvwx:poll-secret'), '');
assert.equal(webLogin.parseWebLoginQr('https://admin.example/login'), '');
const confirmationCalls = [];
const flow = webLogin.createWebLoginFlow({
  async fetchInfo(id) {
    return { id, status: 'pending', origin: 'https://admin.example', expiresAt: '2026-10-03T05:00:00.000Z', pollKey: 'must-not-cross' };
  },
  async approve(id) { confirmationCalls.push(['approve', id]); },
  async reject(id) { confirmationCalls.push(['reject', id]); },
});
const flowState = await flow.scan('blacklight-admin:abcdefghijklmnopqrstuvwx');
assert.equal(flowState.info.origin, 'https://admin.example');
assert.deepEqual(Object.keys(flowState.info).sort(), ['expiresAt', 'id', 'origin', 'status']);
await flow.decide('approve');
assert.equal(flow.state.status, 'approved');
assert.deepEqual(confirmationCalls, [['approve', 'abcdefghijklmnopqrstuvwx']]);
await assert.rejects(flow.decide('reject'), /不能处理/);
const rejectionCalls = [];
const rejectFlow = webLogin.createWebLoginFlow({
  async fetchInfo(id) { return { id, status: 'pending', origin: 'https://admin.example', expiresAt: '2026-10-03T05:00:00.000Z' }; },
  async approve(id) { rejectionCalls.push(['approve', id]); },
  async reject(id) { rejectionCalls.push(['reject', id]); },
});
await rejectFlow.scan('blacklight-admin:abcdefghijklmnopqrstuvwx');
await rejectFlow.decide('reject');
assert.equal(rejectFlow.state.status, 'rejected');
assert.deepEqual(rejectionCalls, [['reject', 'abcdefghijklmnopqrstuvwx']]);
const scopeCopy = webLogin.describeApprovalScope({
  user: { id: 'u-mod', displayName: '负责人' },
  role: 'moderator',
  memberStatus: 'active',
  club: { id: 'club-a' },
});
assert.match(scopeCopy.account, /负责人/);
assert.match(scopeCopy.scope, /不会新增任何社团或平台权限/);
const webApiSource = readFileSync(join(BACKEND_ROOT, 'admin-web/api.js'), 'utf8');
const webAppSource = readFileSync(join(BACKEND_ROOT, 'admin-web/app.js'), 'utf8');
const serverAuthSource = readFileSync(join(BACKEND_ROOT, 'server/admin-web-auth.js'), 'utf8');
const miniLoginSource = readFileSync(join(ROOT, 'pages/admin/web-login/index.wxml'), 'utf8');
const miniInboxSource = readFileSync(join(ROOT, 'pages/admin/management/index.wxml'), 'utf8');
const miniInboxLogic = readFileSync(join(ROOT, 'pages/admin/management/index.js'), 'utf8');
const logoutFunction = webAppSource.match(/async function logout\(\) \{[\s\S]*?\n  \}/)[0];
const expireFunction = webAppSource.match(/async function expireSession\(\) \{[\s\S]*?\n  \}/)[0];
assert.match(webApiSource, /X-CSRF-Token|credentials/);
assert.match(webAppSource, /collectPagedItems/);
assert.match(webAppSource, /candidatePagesComplete !== true \|\| current\.invitePagesComplete !== true/);
assert.match(webAppSource, /team\.length > 50/);
assert.match(webAppSource, /新一届管理团队最多 50 人/);
assert.match(logoutFunction, /failure\.kind === 'expired'[\s\S]*?await expireSession\(\)/);
assert.match(expireFunction, /clearExpiredSessionState\(state\)[\s\S]*?renderLogin\(\)/);
assert.match(webAppSource, /item\.actorId \|\| '管理成员'/);
assert.match(webAppSource, /item\.targetType/);
assert.doesNotMatch(webAppSource, /localStorage|sessionStorage/);
assert.doesNotMatch(webAppSource, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
assert.match(webAppSource, /role="dialog" aria-modal="true"/);
assert.match(webAppSource, /await showActionDialog\(/);
assert.match(webAppSource, /使用小程序扫码并确认登录；仅显示当前账号有权管理的社团。换届或权限变化后需重新登录。请核对确认页中的访问地址。/);
assert.doesNotMatch(webAppSource, /二维码事务|轮询凭据/);
assert.match(webAppSource, /managementTermVersion/);
assert.match(webAppSource, /expectedMembershipVersion: selected\.version/);
assert.match(webAppSource, /decision: 'approve'/);
assert.match(webAppSource, /dateText\(item\.submittedAt\)/);
assert.match(webAppSource, /appealId: targetId/);
assert.doesNotMatch(webAppSource, /item\.actions/);
assert.match(webApiSource, /'admin\/appeal\/decide'/);
assert.match(serverAuthSource, /'admin\/appeal\/decide'/);
assert.match(webAppSource, /恢复完成后仅目标账号保留管理权限，现有其他管理员降为普通成员。/);
assert.match(miniLoginSource, /请核对确认页中的访问地址/);
assert.match(miniInboxSource, /恢复完成后仅目标账号保留管理权限，现有其他管理员降为普通成员。/);
assert.match(miniInboxLogic, /恢复完成后仅目标账号保留管理权限，现有其他管理员降为普通成员。/);

const browserRootListeners = {};
const browserRoot = {
  html: '',
  addEventListener(type, listener) { browserRootListeners[type] = listener; },
  set innerHTML(value) { this.html = value; },
  get innerHTML() { return this.html; },
};
let clearedCsrf = 0;
const expiredBrowser = loadGlobalScript(join(BACKEND_ROOT, 'admin-web/app.js'), {
  AdminCore: core,
  AdminApi: {
    createAdminApi() {
      return {
        async getSession() {
          return {
            user: { id: 'u-old', displayName: '旧账号' }, platformRole: 'none',
            clubs: [{ id: 'club-a', name: '社团甲', role: 'moderator' }],
          };
        },
        async action(action) {
          if (action === 'admin/overview') return { activeMembers: 1, pending: {}, term: {} };
          if (action === 'admin/queue') return { items: [] };
          if (action === 'admin/management/team') {
            return { term: { version: 1, primaryUserId: 'u-current' }, members: [{ targetUserId: 'u-current', displayName: 'STALE_TEAM_MANAGER', role: 'moderator', status: 'active', version: 1 }] };
          }
          if (action === 'admin/members/list') {
            return { items: [{ targetUserId: 'u-candidate', displayName: 'STALE_TEAM_CANDIDATE', role: 'member', status: 'active', version: 1 }] };
          }
          if (action === 'admin/invites/list') {
            return { items: [{ inviteId: 'stale-invite-opaque', status: 'active', mode: 'application', reservedCount: 0 }] };
          }
          if (action === 'admin/handovers/list') return { items: [] };
          throw new Error(`unexpected UI-test action ${action}`);
        },
        async logout() { throw Object.assign(new Error('请重新扫码登录'), { status: 401 }); },
        clearCsrf() { clearedCsrf += 1; },
      };
    },
  },
  document: { getElementById(id) { return id === 'app' ? browserRoot : null; } },
  window: { location: { origin: 'http://127.0.0.1:18884' } },
  navigator: {},
});
async function waitForBrowserHtml(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('browser UI did not reach the expected state');
}
await waitForBrowserHtml(() => browserRoot.innerHTML.includes('社团治理概览'));
await browserRootListeners.click({
  target: { closest: (selector) => (selector === '[data-view]' ? { dataset: { view: 'team' } } : null) },
});
await waitForBrowserHtml(() => browserRoot.innerHTML.includes('STALE_TEAM_MANAGER') && browserRoot.innerHTML.includes('stale-invite-opaque'));
await browserRootListeners.click({
  target: { closest: (selector) => (selector === '[data-action]' ? { dataset: { action: 'logout' } } : null) },
});
assert.match(browserRoot.innerHTML, /小程序确认登录/, 'an expired logout renders the QR login page');
assert.doesNotMatch(browserRoot.innerHTML, /STALE_TEAM_MANAGER|STALE_TEAM_CANDIDATE|stale-invite-opaque/);
assert.ok(clearedCsrf >= 1, 'an expired logout clears the in-memory CSRF token');

function platformBrowserRoot() {
  const listeners = {};
  const root = {
    html: '',
    addEventListener(type, listener) { listeners[type] = listener; },
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
  };
  return { root, listeners };
}

async function waitForHtml(root, predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate(root.innerHTML)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('platform UI did not reach the expected state');
}

const { root: platformRoot } = platformBrowserRoot();
const platformClub = {
  id: 'club-platform-known', name: '已知平台社团', status: 'active', version: 2,
  primaryUserId: 'u-current', managementTermVersion: 3,
};
loadGlobalScript(join(BACKEND_ROOT, 'admin-web/app.js'), {
  AdminCore: core,
  AdminApi: {
    createAdminApi() {
      return {
        async getSession() { return { user: { id: 'u-developer', displayName: '平台开发者' }, platformRole: 'developer', clubs: [] }; },
        async action(action) {
          if (action === 'platform/clubs/list') return { list: [platformClub] };
          if (action === 'platform/recovery/list') return { items: [] };
          throw new Error(`unexpected platform UI-test action ${action}`);
        },
        async logout() {},
        clearCsrf() {},
      };
    },
  },
  document: { getElementById(id) { return id === 'app' ? platformRoot : null; } },
  window: { location: { origin: 'http://127.0.0.1:18884' } },
  navigator: {},
});
await waitForHtml(platformRoot, (html) => html.includes('已知平台社团'));
assert.match(platformRoot.innerHTML, /data-form="platform-update"/, 'the first club from the API list is selected for metadata editing');
assert.match(platformRoot.innerHTML, /data-form="recovery-request"/, 'the selected club renders its recovery request form');

const renderFailureRoot = platformBrowserRoot().root;
const renderFailureCore = {
  ...core,
  escapeHTML(value) {
    if (value === 'FORCED_RENDER_FAILURE') throw new Error('forced render failure');
    return core.escapeHTML(value);
  },
};
loadGlobalScript(join(BACKEND_ROOT, 'admin-web/app.js'), {
  AdminCore: renderFailureCore,
  AdminApi: {
    createAdminApi() {
      return {
        async getSession() { return { user: { id: 'u-developer', displayName: '平台开发者' }, platformRole: 'developer', clubs: [] }; },
        async action(action) {
          if (action === 'platform/clubs/list') return { list: [{ ...platformClub, name: 'FORCED_RENDER_FAILURE' }] };
          if (action === 'platform/recovery/list') return { items: [] };
          throw new Error(`unexpected render-failure UI-test action ${action}`);
        },
        async logout() {},
        clearCsrf() {},
      };
    },
  },
  document: { getElementById(id) { return id === 'app' ? renderFailureRoot : null; } },
  window: { location: { origin: 'http://127.0.0.1:18884' } },
  navigator: {},
});
await waitForHtml(renderFailureRoot, (html) => html.includes('当前工作区暂时无法显示'));
assert.doesNotMatch(renderFailureRoot.innerHTML, /FORCED_RENDER_FAILURE/);

console.log('OK: role visibility, stale club responses, one-time invite lifecycle, browser CSRF, loopback guard, Mini confirmation flow, expired logout reset, platform list selection, and render-error recovery passed');
