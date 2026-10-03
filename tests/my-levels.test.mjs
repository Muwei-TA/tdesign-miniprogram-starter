import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'pages/my/index.js'), 'utf8')
  .replace("import Page from '~/utils/themed-page';", '')
  .replace("import request from '~/api/request';", 'const request = __request;')
  .replace("import { fetchMyLevels, checkInForToday } from '~/services/levels';", 'const { fetchMyLevels, checkInForToday } = __levels;')
  .replace("import { getSession, isAdmin } from '~/services/session';", 'const { getSession, isAdmin } = __session;')
  .replace("import { navigateTo } from '~/utils/navigate';", 'const { navigateTo } = __navigation;');

function createPage({ fetchMyLevels, checkInForToday, request = async () => ({}) }) {
  let definition;
  const toasts = [];
  const app = {
    eventBus: { on() {}, off() {} },
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    getApp: () => app,
    __request: request,
    __levels: { fetchMyLevels, checkInForToday },
    __session: { getSession: () => null, isAdmin: () => false },
    __navigation: { navigateTo() {} },
    wx: { showToast(options) { toasts.push(options); } },
  });
  const page = {
    data: { ...definition.data },
    setData(updates) { Object.assign(this.data, updates); },
  };
  Object.entries(definition).forEach(([key, value]) => {
    if (key !== 'data' && typeof value === 'function') page[key] = value;
  });
  page.toasts = toasts;
  return page;
}

function activeSession(id) {
  return { memberStatus: 'active', role: 'member', user: { id, displayName: id }, club: { id: 'club-a' } };
}

function snapshot({ totalXp = 135, awardedXp } = {}) {
  return {
    level: 3,
    title: '青枝',
    totalXp,
    currentLevelXp: 120,
    nextLevelXp: 280,
    progressXp: totalXp - 120,
    progressTargetXp: 160,
    today: { earnedXp: 8, maxXp: 19, checkedIn: true, reactions: 2, maxReactions: 5, comments: 1, maxComments: 3 },
    ...(awardedXp === undefined ? {} : { awardedXp }),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const currentPage = createPage({ fetchMyLevels: async () => snapshot(), checkInForToday: async () => snapshot() });
currentPage.syncSession(activeSession('member-a'));
await currentPage.loadLevels();
assert.equal(currentPage.data.levelSnapshot.totalXp, 135);
assert.equal(currentPage.data.levelProgressPercent, 9.375, 'progress is measured within the current level band');
assert.equal(currentPage.data.showLevelProgress, true, 'levels below the cap show their upgrade progress bar');
assert.equal(currentPage.data.levelRemainingXp, 145);

const maxLevelPage = createPage({ fetchMyLevels: async () => ({}), checkInForToday: async () => ({}) });
maxLevelPage.applyLevelSnapshot({
  level: 8,
  title: '长明',
  totalXp: 2008,
  currentLevelXp: 2000,
  nextLevelXp: null,
  progressXp: 8,
  progressTargetXp: 0,
  today: { earnedXp: 0, maxXp: 19, checkedIn: false, reactions: 0, maxReactions: 5, comments: 0, maxComments: 3 },
});
assert.equal(maxLevelPage.data.isMaxLevel, true);
assert.equal(maxLevelPage.data.showLevelProgress, false, 'L8 has no upgrade progress bar');
assert.equal(maxLevelPage.data.levelProgressPercent, 0, 'the hidden L8 progress is not presented as full');
assert.equal(maxLevelPage.data.levelSnapshot.totalXp, 2008, 'L8 continues to show accumulated experience');

currentPage.data.levelsError = false;
currentPage.levelsRequestId += 1;
const sameAccountFailurePage = createPage({
  fetchMyLevels: async () => { throw { kind: 'network' }; },
  checkInForToday: async () => snapshot(),
});
sameAccountFailurePage.syncSession(activeSession('member-a'));
sameAccountFailurePage.applyLevelSnapshot(snapshot());
await sameAccountFailurePage.loadLevels();
assert.equal(sameAccountFailurePage.data.levelSnapshot.totalXp, 135, 'a read failure keeps this account’s last confirmed snapshot');
assert.equal(sameAccountFailurePage.data.levelsError, true);

const levelReads = [deferred(), deferred()];
let levelReadIndex = 0;
const accountSwitchPage = createPage({
  fetchMyLevels: () => levelReads[levelReadIndex++].promise,
  checkInForToday: async () => snapshot(),
});
accountSwitchPage.syncSession(activeSession('member-a'));
const staleAccountRead = accountSwitchPage.loadLevels();
accountSwitchPage.applyLevelSnapshot(snapshot());
accountSwitchPage.syncSession(activeSession('member-b'));
assert.equal(accountSwitchPage.data.levelSnapshot, null, 'switching accounts immediately clears the prior account snapshot');
const currentAccountRead = accountSwitchPage.loadLevels();
levelReads[0].resolve(snapshot({ totalXp: 900 }));
await staleAccountRead;
assert.equal(accountSwitchPage.data.levelSnapshot, null, 'a stale account response cannot repopulate the page');
levelReads[1].resolve(snapshot({ totalXp: 40 }));
await currentAccountRead;
assert.equal(accountSwitchPage.data.levelSnapshot.totalXp, 40);

const pendingCheckIn = deferred();
const checkInPage = createPage({
  fetchMyLevels: async () => snapshot(),
  checkInForToday: () => pendingCheckIn.promise,
});
checkInPage.syncSession(activeSession('member-a'));
checkInPage.applyLevelSnapshot({ ...snapshot(), today: { ...snapshot().today, checkedIn: false } });
const staleCheckIn = checkInPage.onCheckInTap();
checkInPage.syncSession(activeSession('member-b'));
pendingCheckIn.resolve({ ...snapshot({ totalXp: 140, awardedXp: 5 }), today: { ...snapshot().today, checkedIn: true } });
await staleCheckIn;
assert.equal(checkInPage.data.levelSnapshot, null, 'a check-in response from a previous account is ignored');

const confirmedCheckInPage = createPage({
  fetchMyLevels: async () => snapshot(),
  checkInForToday: async () => ({ ...snapshot({ totalXp: 140, awardedXp: 5 }), today: { ...snapshot().today, checkedIn: true } }),
});
confirmedCheckInPage.syncSession(activeSession('member-c'));
confirmedCheckInPage.applyLevelSnapshot({ ...snapshot(), today: { ...snapshot().today, checkedIn: false } });
await confirmedCheckInPage.onCheckInTap();
assert.equal(confirmedCheckInPage.data.levelSnapshot.totalXp, 140, 'the page updates only from the confirmed check-in snapshot');
assert.equal(confirmedCheckInPage.data.levelSnapshot.today.checkedIn, true);
assert.match(confirmedCheckInPage.toasts[0].title, /经验 \+5/);

const oldLevelRead = deferred();
const checkInResponse = deferred();
const staleReadPage = createPage({
  fetchMyLevels: () => oldLevelRead.promise,
  checkInForToday: () => checkInResponse.promise,
});
staleReadPage.syncSession(activeSession('member-d'));
staleReadPage.applyLevelSnapshot({ ...snapshot(), today: { ...snapshot().today, checkedIn: false } });
const oldReadPromise = staleReadPage.loadLevels();
const checkInPromise = staleReadPage.onCheckInTap();
checkInResponse.resolve({ ...snapshot({ totalXp: 140, awardedXp: 5 }), today: { ...snapshot().today, checkedIn: true } });
await checkInPromise;
oldLevelRead.resolve({ ...snapshot({ totalXp: 135 }), today: { ...snapshot().today, checkedIn: false } });
await oldReadPromise;
assert.equal(staleReadPage.data.levelSnapshot.totalXp, 140, 'an older GET cannot overwrite a confirmed check-in snapshot');
assert.equal(staleReadPage.data.levelSnapshot.today.checkedIn, true);

const guestPage = createPage({ fetchMyLevels: async () => snapshot(), checkInForToday: async () => snapshot() });
guestPage.syncSession({ memberStatus: 'none', user: null });
await guestPage.loadLevels();
assert.equal(guestPage.data.levelSnapshot, null, 'guest sessions never load or display level data');

const myMarkup = readFileSync(join(ROOT, 'pages/my/index.wxml'), 'utf8');
assert.match(myMarkup, /wx:if="\{\{ showLevelProgress \}\}" class="hg-my__progress-track"/);
assert.match(myMarkup, /今日已发放/);
assert.match(myMarkup, /每日最多发放 19 XP/);
assert.match(myMarkup, /当日获奖名额不会恢复/);
assert.match(myMarkup, /自行删除已通过审核的回应时，已获得的参与经验保留/);

console.log('OK: level progress, L8 progress hiding, experience reversal copy, account scope, and check-in isolation');
