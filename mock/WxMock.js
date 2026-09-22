/* eslint-disable no-underscore-dangle */
/**
 * 请求拦截器：支持 `METHOD /path/:param` 匹配、query 剥离、函数式响应与未命中穿透。
 * 仅在 config.isMock 为真时装载。Mock 不得为了"方便调试"返回越权数据。
 */

const originRequest = wx.request;

/** routes: Array<{ method, segments, hasParam, handler }> */
const routes = [];

function normalizePath(url) {
  const withoutQuery = String(url).split('?')[0];
  return withoutQuery.replace(/\/+$/, '') || '/';
}

function parseQuery(url) {
  const queryString = String(url).split('?')[1];
  if (!queryString) return {};
  return queryString.split('&').reduce((acc, pair) => {
    const [key, value = ''] = pair.split('=');
    if (key) acc[decodeURIComponent(key)] = decodeURIComponent(value);
    return acc;
  }, {});
}

function match(route, method, path) {
  if (route.method !== method) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== route.segments.length) return null;

  const params = {};
  for (let i = 0; i < route.segments.length; i += 1) {
    const seg = route.segments[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = parts[i];
    else if (seg !== parts[i]) return null;
  }
  return params;
}

/**
 * @param {string} key `GET /posts` 或 `POST /posts/:id/comments`
 * @param {*} handler 静态数据或 ({ params, query, body, method, path }) => data
 */
export function route(key, handler) {
  const [method, template] = key.trim().split(/\s+/);
  routes.push({
    method: (method || 'GET').toUpperCase(),
    segments: normalizePath(template).split('/').filter(Boolean),
    handler,
  });
}

export function install() {
  Object.defineProperty(wx, 'request', { writable: true, configurable: true });
  wx.request = function mockedRequest(config = {}) {
    const method = (config.method || 'GET').toUpperCase();
    const path = normalizePath(config.url);
    const query = parseQuery(config.url);

    let hit = null;
    let params = null;
    for (let i = 0; i < routes.length; i += 1) {
      const matched = match(routes[i], method, path);
      if (matched) {
        hit = routes[i];
        params = matched;
        break;
      }
    }

    if (!hit) {
      // 未命中时穿透到真实请求，便于逐步接入后端
      originRequest(config);
      return;
    }

    const body = typeof config.data === 'string' ? safeParse(config.data) : config.data || {};
    const payload = typeof hit.handler === 'function' ? hit.handler({ params, query, body, method, path }) : hit.handler;

    const response = {
      statusCode: (payload && payload.__status) || 200,
      header: {},
      data:
        payload && payload.__status
          ? { code: payload.__code || 'error', message: payload.__message || '请求失败' }
          : { code: 0, message: 'ok', data: payload },
    };

    // 模拟真实网络耗时，便于验证 loading / 骨架屏
    setTimeout(() => {
      if (typeof config.success === 'function') config.success(response);
      if (typeof config.complete === 'function') config.complete(response);
    }, 180 + Math.random() * 220);
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
}

/** 构造错误响应：route('GET /posts', () => fail(404, 'not_accessible')) */
export function fail(status, code, message) {
  return { __status: status, __code: code, __message: message };
}

export default { route, install, fail };
