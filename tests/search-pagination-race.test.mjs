import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../pages/search/index.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from ['"][^'"]+['"];?/g, '');
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { resolve, promise };
}
function harness() {
  let page;
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(source, {
    Page: (value) => { page = value; },
    search: (input) => { const pending = deferred(); calls.push({ ...input, ...pending }); return pending.promise; },
    fetchSuggestions: async () => ({ items: [] }), navigateTo() {}, wx: { showToast() {} },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const ctx = Object.create(page);
  ctx.data = structuredClone(page.data);
  ctx.setData = (patch, callback) => { Object.assign(ctx.data, patch); if (callback) callback(); };
  return { ctx, calls, timers };
}

test('F4 a new query cannot append with the previous query cursor while its first page loads', async () => {
  const { ctx, calls } = harness();
  ctx.setData({ keyword: 'old' });
  const old = ctx.runSearch();
  calls[0].resolve({ items: [{ id: 'old' }], nextCursor: 'old-cursor' });
  await old;
  ctx.onInput({ detail: { value: 'new' } });
  ctx.onReachBottom();
  assert.equal(calls.length, 1);
  const first = ctx.onSubmit();
  ctx.onReachBottom();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, '');
  calls[1].resolve({ items: [{ id: 'new-first' }], nextCursor: 'new-cursor' });
  await first;
  const next = ctx.onReachBottom();
  assert.equal(calls[2].cursor, 'new-cursor');
  calls[2].resolve({ items: [{ id: 'new-second' }], nextCursor: null });
  await next;
  assert.deepEqual(Array.from(ctx.data.results, (r) => r.id), ['new-first', 'new-second']);
});

test('F4 changing scope invalidates an in-flight append and resets loadingMore', async () => {
  const { ctx, calls } = harness();
  ctx.setData({ keyword: 'word' });
  let request = ctx.runSearch();
  calls[0].resolve({ items: [{ id: 'post1' }], nextCursor: 'c1' });
  await request;
  const oldAppend = ctx.onReachBottom();
  request = ctx.onScopeTap({ currentTarget: { dataset: { value: 'topic' } } });
  assert.equal(ctx.data.loadingMore, false);
  calls[1].resolve({ items: [{ id: 'old-post2' }], nextCursor: 'c2' });
  await oldAppend;
  calls[2].resolve({ items: [{ id: 'topic1' }], nextCursor: null });
  await request;
  assert.deepEqual(Array.from(ctx.data.results, (r) => r.id), ['topic1']);
});

test('F4 clearing input cancels debounce and ignores outstanding responses', async () => {
  const { ctx, calls, timers } = harness();
  ctx.setData({ keyword: 'word' });
  const request = ctx.runSearch();
  ctx.onInput({ detail: { value: '' } });
  calls[0].resolve({ items: [{ id: 'obsolete' }], nextCursor: 'obsolete-cursor' });
  await request;
  assert.equal(ctx.data.results.length, 0);
  assert.equal(ctx.data.hasMore, false);
  assert.equal(ctx.data.loadingMore, false);
  assert.equal(timers.size, 0);
});
