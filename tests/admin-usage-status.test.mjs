import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const usageServiceSource = readFileSync(join(ROOT, 'services/usage.js'), 'utf8')
  .replace("import request from '~/api/request';", 'const request = __request;')
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export function /g, 'function ')
  .replace('export default { fetchUsageStatus };', '')
  .concat('\nmodule.exports = { fetchUsageStatus };');
const usageCalls = [];
const usageServiceModule = { exports: {} };
vm.runInNewContext(usageServiceSource, {
  module: usageServiceModule,
  exports: usageServiceModule.exports,
  __request: (url) => {
    usageCalls.push(url);
    return Promise.resolve({ ready: true });
  },
  __endpoints: { adminUsageStatus: '/admin/usage/status' },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await usageServiceModule.exports.fetchUsageStatus())),
  { ready: true },
);
assert.deepEqual(usageCalls, ['/admin/usage/status']);

function loadAdminPage(fetchUsageStatus) {
  const source = readFileSync(join(ROOT, 'pages/admin/index.js'), 'utf8')
    .replace(
      /import \{[\s\S]*?\} from '~\/services\/moderation';/,
      'const { QUEUES, fetchQueue, fetchAssetReviewStatuses, submitDecision, decideComment, decideTopic, decideMembership, decideReport, decideCollection } = __moderation;',
    )
    .replace("import { fetchUsageStatus } from '~/services/usage';", 'const { fetchUsageStatus } = __usage;')
    .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

  let definition;
  vm.runInNewContext(source, {
    Page(value) {
      definition = value;
    },
    getApp: () => ({ eventBus: { on() {}, off() {} }, globalData: {} }),
    __moderation: {
      QUEUES: [],
      fetchQueue() {},
      fetchAssetReviewStatuses() {},
      submitDecision() {},
      decideComment() {},
      decideTopic() {},
      decideMembership() {},
      decideReport() {},
      decideCollection() {},
    },
    __usage: { fetchUsageStatus },
    __navigation: { navigateTo() {} },
  });
  assert.ok(definition, 'admin page must register a Page definition');
  return definition;
}

function pageContext(definition, patch = {}) {
  const context = {
    data: { ...definition.data, ...patch },
    setData(updates, callback) {
      Object.assign(this.data, updates);
      if (callback) callback();
    },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') context[key] = value;
  });
  return context;
}

const MiB = 1024 * 1024;
const status = {
  date: '2026-09-23',
  timezone: 'UTC',
  updatedAt: '2026-09-23T01:00:00.000Z',
  upload: {
    usedBytes: 10 * MiB,
    reservedBytes: 5 * MiB,
    dailyLimitBytes: 200 * MiB,
    userDailyLimitBytes: 20 * MiB,
    remainingBytes: 185 * MiB,
    warningRatio: 0.8,
    alertState: 'near_limit',
  },
  review: {
    calls: 50,
    textCalls: 35,
    imageCalls: 15,
    dailyLimitCalls: 1000,
    remainingCalls: 950,
    warningRatio: 0.8,
    alertState: 'ok',
    alertedAt: null,
  },
};

let readStatus = async () => status;
let readCalls = 0;
const adminPage = loadAdminPage(async () => {
  readCalls += 1;
  return readStatus();
});
const moderator = pageContext(adminPage, {
  session: { role: 'moderator', memberStatus: 'active' },
  accessState: 'allowed',
});

await adminPage.loadUsageStatus.call(moderator);
assert.equal(readCalls, 1);
assert.equal(moderator.data.usageStatus.date, '2026-09-23');
assert.equal(moderator.data.usageStatus.upload.usedText, '10.00 MiB');
assert.equal(moderator.data.usageStatus.upload.limitText, '200.00 MiB');
assert.equal(moderator.data.usageStatus.upload.userLimitText, '20.00 MiB');
assert.equal(moderator.data.usageStatus.upload.label, '接近限额');
assert.equal(moderator.data.usageErrorText, '');

const guest = pageContext(adminPage, {
  session: { role: 'guest', memberStatus: 'none' },
  accessState: 'denied',
});
await adminPage.loadUsageStatus.call(guest);
assert.equal(readCalls, 1, 'non-admin sessions must not request the usage endpoint');
assert.equal(guest.data.usageStatus, null);

readStatus = async () => { throw new Error('用量接口暂不可用'); };
await adminPage.loadUsageStatus.call(moderator);
assert.equal(moderator.data.usageStatus.date, '2026-09-23', 'refresh failure should retain the last snapshot');
assert.equal(moderator.data.usageErrorText, '用量接口暂不可用');
assert.equal(moderator.data.usageLoading, false);

readStatus = async () => ({
  ...status,
  upload: {
    ...status.upload,
    usedBytes: 0,
    reservedBytes: 0,
    dailyLimitBytes: 0,
    userDailyLimitBytes: 0,
    remainingBytes: 0,
    alertState: 'disabled',
  },
  review: { ...status.review, calls: 0, textCalls: 0, imageCalls: 0, dailyLimitCalls: 0, remainingCalls: 0, alertState: 'disabled' },
});
await adminPage.onUsageRefresh.call(moderator);
assert.equal(moderator.data.usageStatus.upload.label, '未配置 / 已关闭');
assert.equal(moderator.data.usageStatus.upload.limitText, '', 'disabled limits must not look like healthy zero quotas');
assert.equal(moderator.data.usageStatus.upload.userLimitDisabled, true);
assert.equal(moderator.data.usageStatus.review.limitCalls, 0);
assert.equal(moderator.data.usageStatus.review.label, '未配置 / 已关闭');

readStatus = async () => ({ ...status, upload: { ...status.upload, userDailyLimitBytes: undefined } });
await adminPage.loadUsageStatus.call(moderator);
assert.equal(moderator.data.usageStatus.date, '2026-09-23', 'invalid responses should not replace the last snapshot');
assert.match(moderator.data.usageErrorText, /userDailyLimitBytes/);

const wxml = readFileSync(join(ROOT, 'pages/admin/index.wxml'), 'utf8');
assert.match(wxml, /bindtap="onUsageRefresh"/);
assert.match(wxml, /读取失败：\{\{ usageErrorText \}\}/);
assert.match(wxml, /社团总量护栏未配置或已关闭/);
assert.match(wxml, /单账号滚动 24 小时上限/);
assert.match(wxml, /wx:elif="\{\{ accessState === 'denied' \}\}"[\s\S]*?<block wx:else>[\s\S]*?hg-admin__usage/);

let resolveInFlight;
readStatus = () => new Promise((resolve) => { resolveInFlight = resolve; });
const inFlightRead = adminPage.loadUsageStatus.call(moderator);
assert.equal(moderator.data.usageLoading, true);
await adminPage.applySession.call(moderator, { role: 'guest', memberStatus: 'none', user: null });
assert.equal(moderator.data.usageStatus, null);
assert.equal(moderator.data.usageLoading, false);
assert.equal(moderator.data.usageErrorText, '');
resolveInFlight(status);
await inFlightRead;
assert.equal(moderator.data.accessState, 'denied');
assert.equal(moderator.data.usageStatus, null, 'a response from the previous moderator session must not repopulate the status');

console.log('OK: admin usage status is role-gated, shows UTC limits, retains snapshots on errors, and labels disabled quotas');
