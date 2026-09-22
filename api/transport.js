/**
 * 把现有 service 使用的 HTTP 风格 endpoint 转成 api 云函数契约。
 *
 * 页面与 service 不感知 CloudBase：它们仍传入 /posts、/posts/:id 等路径，
 * 真实传输层再把路径参数和 query 组装成 { action, payload }。
 */

const ROUTES = [
  // 会话与成员资格。小程序原生身份不再交换 session token。
  { method: 'GET', pattern: '/session/me', action: 'session/me' },
  { method: 'POST', pattern: '/session/wechat', action: 'session/me', map: () => ({}) },
  { method: 'POST', pattern: '/membership/applications', action: 'membership/apply' },
  { method: 'GET', pattern: '/membership/applications/mine', action: 'membership/mine' },
  { method: 'GET', pattern: '/me/profile', action: 'me/profile' },
  { method: 'POST', pattern: '/me/profile/update', action: 'me/profile/update' },
  { method: 'PATCH', pattern: '/me/profile', action: 'me/profile/update' },
  { method: 'POST', pattern: '/me/exports', action: 'me/exports' },
  { method: 'DELETE', pattern: '/me/account', action: 'me/account/delete' },
  { method: 'GET', pattern: '/profile/:targetUserId', action: 'profile/get' },

  // 内容。
  { method: 'GET', pattern: '/posts', action: 'posts/list' },
  { method: 'POST', pattern: '/posts', action: 'posts/create' },
  { method: 'GET', pattern: '/posts/:id', action: 'posts/detail', map: ({ params }) => ({ id: params.id }) },
  { method: 'DELETE', pattern: '/posts/:id', action: 'posts/delete' },
  { method: 'PATCH', pattern: '/posts/:id/visibility', action: 'posts/visibility' },
  {
    method: 'PUT',
    pattern: '/posts/:id/reaction',
    action: 'posts/reaction',
    map: ({ params }) => ({ id: params.id, next: true }),
  },
  {
    method: 'DELETE',
    pattern: '/posts/:id/reaction',
    action: 'posts/reaction',
    map: ({ params }) => ({ id: params.id, next: false }),
  },
  {
    method: 'PUT',
    pattern: '/posts/:id/bookmark',
    action: 'posts/bookmark',
    map: ({ params }) => ({ id: params.id, next: true }),
  },
  {
    method: 'DELETE',
    pattern: '/posts/:id/bookmark',
    action: 'posts/bookmark',
    map: ({ params }) => ({ id: params.id, next: false }),
  },
  {
    method: 'GET',
    pattern: '/posts/:id/comments',
    action: 'posts/comments/list',
  },
  {
    method: 'POST',
    pattern: '/posts/:id/comments',
    action: 'posts/comments/create',
  },
  {
    method: 'GET',
    pattern: '/me/contents',
    action: ({ payload }) => (payload.tab === 'topics' ? 'me/topics' : 'me/contents'),
    map: ({ payload }) => (payload.tab === 'topics' ? { cursor: payload.cursor } : payload),
  },
  { method: 'POST', pattern: '/reports', action: 'reports/create' },

  // 话题。
  { method: 'GET', pattern: '/topics', action: 'topics/list' },
  { method: 'POST', pattern: '/topics', action: 'topics/create' },
  { method: 'GET', pattern: '/topics/:id', action: 'topics/detail', map: ({ params, payload }) => ({ id: params.id, cursor: payload.cursor }) },
  {
    method: 'PUT',
    pattern: '/topics/:id/follow',
    action: 'topics/follow',
    map: ({ params }) => ({ id: params.id, next: true }),
  },
  {
    method: 'DELETE',
    pattern: '/topics/:id/follow',
    action: 'topics/follow',
    map: ({ params }) => ({ id: params.id, next: false }),
  },
  { method: 'GET', pattern: '/me/topics', action: 'me/topics' },

  // 文集与授权。
  { method: 'GET', pattern: '/collections', action: 'collections/list' },
  { method: 'GET', pattern: '/collections/:id', action: 'collections/detail', map: ({ params }) => ({ id: params.id }) },
  { method: 'POST', pattern: '/collections/:id/submissions', action: 'collections/submit' },
  { method: 'DELETE', pattern: '/consents/:postId', action: 'consents/revoke' },

  // 消息。
  { method: 'GET', pattern: '/notifications', action: 'notifications/list' },
  { method: 'POST', pattern: '/notifications/read-all', action: 'notifications/read-all' },
  { method: 'GET', pattern: '/notifications/unread-count', action: 'notifications/unread-count' },

  // 搜索。
  { method: 'GET', pattern: '/search', action: 'search/query' },
  { method: 'GET', pattern: '/search/suggestions', action: 'search/suggestions' },
  { method: 'GET', pattern: '/search/private', action: 'search/private' },

  // 媒体。
  { method: 'POST', pattern: '/assets/upload-intents', action: 'assets/intent' },
  { method: 'POST', pattern: '/assets/upload', action: 'assets/upload' },
  { method: 'POST', pattern: '/assets/confirm', action: 'assets/confirm' },
  { method: 'GET', pattern: '/assets/:id', action: 'assets/status', map: ({ params }) => ({ assetId: params.id }) },

  { method: 'GET', pattern: '/admin/members', action: 'admin/members/list' },
  { method: 'POST', pattern: '/admin/members/:targetUserId/remove', action: 'admin/member/remove' },
  { method: 'POST', pattern: '/admin/members/:targetUserId/mute', action: 'admin/member/mute' },
  { method: 'POST', pattern: '/admin/members/:targetUserId/role', action: 'admin/member/role' },
  { method: 'POST', pattern: '/admin/invites', action: 'admin/invites/create' },
  { method: 'GET', pattern: '/appeals/mine', action: 'appeals/mine' },
  { method: 'POST', pattern: '/appeals', action: 'appeals/create' },
  { method: 'GET', pattern: '/admin/appeals', action: 'admin/appeals/list' },
  { method: 'POST', pattern: '/admin/appeals/:appealId/decision', action: 'admin/appeal/decide' },
  // 管理台。
  { method: 'GET', pattern: '/admin/queues/:queue', action: 'admin/queue' },
  { method: 'POST', pattern: '/admin/reviews/:id/decision', action: 'admin/content/decide' },
  { method: 'POST', pattern: '/admin/comments/:id/decision', action: 'admin/comment/decide' },
  { method: 'POST', pattern: '/admin/topics/:id/decision', action: 'admin/topic/decide' },
  { method: 'POST', pattern: '/admin/members/applications/:id', action: 'admin/membership/decide' },
  { method: 'POST', pattern: '/admin/reports/:id/decision', action: 'admin/report/decide' },
  { method: 'POST', pattern: '/admin/collections/:id/decision', action: 'admin/collection/decide' },
  { method: 'POST', pattern: '/admin/anonymous/reveal', action: 'admin/anonymous/reveal' },
];

function normalizePath(url) {
  const path = String(url || '/').split('?')[0];
  return path.replace(/\/+$/, '') || '/';
}

function decode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (err) {
    return value;
  }
}

function parseQuery(url) {
  const queryString = String(url || '').split('?')[1];
  if (!queryString) return {};
  return queryString.split('&').reduce((query, pair) => {
    const [rawKey, rawValue = ''] = pair.split('=');
    if (rawKey) query[decode(rawKey)] = decode(rawValue);
    return query;
  }, {});
}

function matchPattern(pattern, path) {
  const expected = normalizePath(pattern).split('/').filter(Boolean);
  const actual = normalizePath(path).split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;

  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const expectedPart = expected[index];
    if (expectedPart.startsWith(':')) params[expectedPart.slice(1)] = decode(actual[index]);
    else if (expectedPart !== actual[index]) return null;
  }
  return params;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function omitUndefined(value) {
  if (!isObject(value)) return {};
  return Object.keys(value).reduce((result, key) => {
    if (value[key] !== undefined) result[key] = value[key];
    return result;
  }, {});
}

/**
 * 将 HTTP 风格调用转换为后端 api 云函数的 action/payload。
 * @param {string} url 路径，可包含 query
 * @param {string} method HTTP method
 * @param {object} body 请求体
 * @returns {{ action: string, payload: object }}
 */
export function resolveTransport(url, method, body = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const path = normalizePath(url);
  const query = parseQuery(url);
  const route = ROUTES.find((candidate) => candidate.method === normalizedMethod && matchPattern(candidate.pattern, path));

  if (!route) {
    const error = new Error(`Unsupported API endpoint: ${normalizedMethod} ${path}`);
    error.code = 'invalid_input';
    throw error;
  }

  const params = matchPattern(route.pattern, path);
  const safeBody = isObject(body) ? body : {};
  const payload = { ...query, ...safeBody, ...params };
  const mappedPayload = route.map ? route.map({ params, query, body: safeBody, method: normalizedMethod, payload }) : payload;
  const action = typeof route.action === 'function'
    ? route.action({ params, query, body: safeBody, method: normalizedMethod, payload, mappedPayload })
    : route.action;

  return { action, payload: omitUndefined(mappedPayload) };
}

/**
 * 幂等键统一进入业务 payload，供云函数 claimIdempotency 使用。
 * 不写入 Authorization 或自定义 HTTP header；同一键可安全重试。
 */
export function withIdempotency(payload, idempotencyKey) {
  const next = isObject(payload) ? { ...payload } : {};
  const key = idempotencyKey || next.idempotencyKey;
  if (key) next.idempotencyKey = key;
  return next;
}
