import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const busSource = fs.readFileSync(new URL('../utils/eventBus.js', import.meta.url), 'utf8');
const bus = vm.runInNewContext(busSource.replace('export default function createBus()', 'function createBus()') + '\ncreateBus()');
const app = { globalData: { session: { club: { id: 'heiguang' } } }, eventBus: bus };
let component;
vm.runInNewContext(fs.readFileSync(new URL('../custom-tab-bar/index.js', import.meta.url), 'utf8'), {
  getApp: () => app,
  getCurrentPages: () => [{ route: 'pages/home/index' }],
  Component: (value) => { component = value; },
});
let homeUpdates = 0;
bus.on('session-changed', () => { homeUpdates += 1; });
const tab = { data: { value: '', isBlackbox: false }, ...component.methods,
  setData(patch) { Object.assign(this.data, patch); } };
// A tab destroyed before ready must not unsubscribe the home page.
component.lifetimes.detached.call(tab);
component.lifetimes.ready.call(tab);
app.globalData.session = { club: { id: 'blackbox-animation' } };
bus.emit('session-changed', app.globalData.session);
assert.equal(tab.data.isBlackbox, true);
assert.equal(homeUpdates, 1);
app.globalData.session = { club: { id: 'heiguang' } };
bus.emit('session-changed', app.globalData.session);
assert.equal(tab.data.isBlackbox, false);
component.lifetimes.detached.call(tab);
bus.emit('session-changed', app.globalData.session);
assert.equal(homeUpdates, 3);
assert.equal(bus.events['session-changed'].length, 1);
