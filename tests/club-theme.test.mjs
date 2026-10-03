import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('themed Page tracks club sessions without changing business listeners or lifecycle contracts', async () => {
  const listeners = new Set();
  const bus = {
    on(event, callback) {
      if (event === 'session-changed') listeners.add(callback);
    },
    off(event, callback) {
      if (event !== 'session-changed') return;
      if (callback) listeners.delete(callback);
      else listeners.clear();
    },
    emit(event) {
      if (event === 'session-changed') [...listeners].forEach((callback) => callback());
    },
  };
  const app = { globalData: { session: { club: { id: 'heiguang' } } }, eventBus: bus };
  const oldPage = globalThis.Page;
  const oldGetApp = globalThis.getApp;
  const definitions = [];
  globalThis.Page = (definition) => {
    definitions.push(definition);
    return 'registered';
  };
  globalThis.getApp = () => app;

  try {
    const source = readFileSync(new URL('../utils/themed-page.js', import.meta.url), 'utf8')
      .replace('export default function themedPage', 'function themedPage');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\nexport { themedPage };`).toString('base64')}`;
    const { themedPage } = await import(moduleUrl);
    const calls = [];
    const loadResult = { load: true };
    const showResult = { show: true };
    const unloadResult = { unload: true };
    const sourceDefinition = {
      data: { keep: 1 },
      onLoad(options) {
        calls.push(['load', this, options]);
        return loadResult;
      },
      onShow(value) {
        calls.push(['show', this, value]);
        return showResult;
      },
      onUnload(value) {
        calls.push(['unload', this, value]);
        return unloadResult;
      },
    };
    assert.equal(themedPage(sourceDefinition), 'registered');
    const definition = definitions[0];
    assert.deepEqual(definition.data, { keep: 1, clubTheme: 'literary', clubThemeStyle: '' });
    assert.deepEqual(sourceDefinition.data, { keep: 1 });

    let pageUpdates = 0;
    const page = {
      data: { ...definition.data },
      setData(patch) {
        pageUpdates += 1;
        Object.assign(this.data, patch);
      },
    };
    let businessCalls = 0;
    const businessListener = () => { businessCalls += 1; };
    bus.on('session-changed', businessListener);
    const options = { from: 'test' };
    assert.equal(definition.onLoad.call(page, options), loadResult);
    assert.deepEqual(calls[0], ['load', page, options]);
    assert.equal(listeners.size, 2);

    app.globalData.session = { club: { id: 'blackbox-animation' } };
    bus.emit('session-changed');
    assert.equal(page.data.clubTheme, 'blackbox');
    assert.match(page.data.clubThemeStyle, /--hg-paper: #ffffff/);
    assert.match(page.data.clubThemeStyle, /--hg-green: #df6b2f/);
    assert.match(page.data.clubThemeStyle, /--hg-font-serif: .*sans-serif/);
    assert.equal(businessCalls, 1);
    assert.deepEqual(app.globalData.session, { club: { id: 'blackbox-animation' } });

    assert.equal(definition.onShow.call(page, 'show-arg'), showResult);
    assert.deepEqual(calls[1], ['show', page, 'show-arg']);
    assert.equal(listeners.size, 2);

    app.globalData.session = null;
    bus.emit('session-changed');
    assert.equal(page.data.clubTheme, 'literary');
    assert.equal(page.data.clubThemeStyle, '');

    assert.equal(definition.onUnload.call(page, 'unload-arg'), unloadResult);
    assert.deepEqual(calls[2], ['unload', page, 'unload-arg']);
    assert.equal(listeners.size, 1);
    const updatesAfterUnload = pageUpdates;
    app.globalData.session = { club: { id: 'blackbox-animation' } };
    bus.emit('session-changed');
    assert.equal(pageUpdates, updatesAfterUnload);
    assert.equal(businessCalls, 3);

    themedPage(sourceDefinition);
    const historyDefinition = definitions[1];
    const historyPage = {
      data: { ...historyDefinition.data },
      setData(patch) { Object.assign(this.data, patch); },
    };
    app.globalData.session = { club: { id: 'heiguang' } };
    historyDefinition.onLoad.call(historyPage, { historyOnly: '1', clubId: 'blackbox-animation' });
    assert.equal(historyPage.data.clubTheme, 'blackbox');
    app.globalData.session = { club: { id: 'heiguang' } };
    bus.emit('session-changed');
    assert.equal(historyPage.data.clubTheme, 'blackbox');
    historyDefinition.onUnload.call(historyPage);

    assert.equal(listeners.size, 1);
  } finally {
    if (oldPage === undefined) delete globalThis.Page;
    else globalThis.Page = oldPage;
    if (oldGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = oldGetApp;
  }
});
