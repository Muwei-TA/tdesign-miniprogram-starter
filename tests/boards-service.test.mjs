import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'services/boards.js'), 'utf8')
  .replace(
    "import request, { withPath, withQuery } from '~/api/request';",
    'const { request, withPath, withQuery } = __api;',
  )
  .replace("import endpoints from '~/api/endpoints';", 'const endpoints = __endpoints;')
  .replace(/export function /g, 'function ')
  .replace('export default ', 'module.exports.default = ')
  .concat('\nmodule.exports = { fetchBoards, fetchBoardDetail, submitBoard, fetchPendingBoards, decideBoard };');

const calls = [];
const withPath = (path, params) => Object.keys(params).reduce(
  (result, key) => result.replace(`:${key}`, encodeURIComponent(params[key])),
  path,
);
const withQuery = (path, query) => {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `${path}?${pairs.join('&')}` : path;
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module,
  __api: {
    withPath,
    withQuery,
    request(url, options = {}) {
      calls.push({ url, options });
      return Promise.resolve({});
    },
  },
  __endpoints: {
    boards: '/boards',
    boardDetail: '/boards/:id',
    adminBoardDecision: '/admin/boards/:id/decision',
  },
  encodeURIComponent,
});

const { fetchBoards, fetchBoardDetail, submitBoard, fetchPendingBoards, decideBoard } = module.exports;
await fetchBoards({ q: '  山茶  ', cursor: 'c 1', status: 'active' });
assert.equal(calls[0].url, '/boards?cursor=c%201&q=%E5%B1%B1%E8%8C%B6&status=active');
await fetchBoardDetail('board/1', 'next');
assert.equal(calls[1].url, '/boards/board%2F1?cursor=next');
await submitBoard({ title: '  夜读  ', description: '  一起读书  ' });
assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), {
  url: '/boards',
  options: { method: 'POST', data: { title: '夜读', description: '一起读书' } },
});
await fetchPendingBoards({ cursor: 'pending-next' });
assert.equal(calls[3].url, '/admin/queues/board?cursor=pending-next');
await decideBoard('board-2', { decision: 'reject', reason: 'scope', expectedVersion: 4 });
assert.deepEqual(JSON.parse(JSON.stringify(calls[4])), {
  url: '/admin/boards/board-2/decision',
  options: { method: 'POST', data: { decision: 'reject', reason: 'scope', expectedVersion: 4 } },
});

console.log('OK: board services use independent endpoints, trim create input, and pass review versions');
