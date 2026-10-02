import config from '~/config';
import { resolveTransport, withIdempotency } from '~/api/transport';

const { cloudFunctionName = 'api' } = config;

/**
 * 统一错误对象。kind 枚举与 docs/04-data-model-and-api.md 4.6 一致。
 * 注意：not_accessible 必须使用统一文案，不得通过差异化文案暴露某条内容是否存在。
 */
export class ApiError extends Error {
  constructor({ kind, httpStatus, code, message, retryable = false, detail = null }) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const KIND_BY_HTTP = {
  400: 'invalid_input',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_accessible',
  409: 'conflict',
  422: 'invalid_input',
  429: 'rate_limited',
};

const HTTP_BY_KIND = {
  unauthenticated: 401,
  membership_invalid: 403,
  forbidden: 403,
  not_accessible: 404,
  invalid_input: 422,
  conflict: 409,
  pending_media: 409,
  rate_limited: 429,
  server: 500,
};

const DEFAULT_MESSAGE = {
  unauthenticated: '需要先完成授权',
  membership_invalid: '社内内容需要有效的成员资格',
  forbidden: '当前没有执行该操作的权限',
  not_accessible: '这条内容当前不可访问',
  invalid_input: '填写内容不符合要求',
  conflict: '内容已被更新，请刷新后重试',
  pending_media: '附件仍在处理中，完成后才能提交',
  rate_limited: '操作过于频繁，请稍后再试',
  network: '网络不可用，请检查后重试',
  timeout: '请求超时，请重试',
  server: '服务暂时不可用，请稍后重试',
};

const AUTH_TIMEOUT_MS = 10000;
const DNS_LABEL_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HTTPS_ORIGIN_PATTERN = new RegExp(
  `^https://((?:${DNS_LABEL_PATTERN}\\.)+${DNS_LABEL_PATTERN})(?::([1-9]\\d{0,4}))?$`,
  'i',
);
let authToken = '';
let authGeneration = 0;
let authPromise = null;

function resolveKind(httpStatus, bodyCode) {
  // 业务码优先：后端可用 code 细分 membership_invalid / pending_media 等。
  if (bodyCode && HTTP_BY_KIND[bodyCode]) return bodyCode;
  if (KIND_BY_HTTP[httpStatus]) return KIND_BY_HTTP[httpStatus];
  if (httpStatus >= 500) return 'server';
  return 'server';
}

function unwrapResult(result) {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch (err) {
      return null;
    }
  }
  return result;
}

function buildError(httpStatus, body) {
  const result = unwrapResult(body);
  const bodyCode = result && result.code;
  const kind = resolveKind(httpStatus, bodyCode);
  return new ApiError({
    kind,
    httpStatus: httpStatus || HTTP_BY_KIND[kind] || 0,
    code: bodyCode,
    // not_accessible 强制统一文案，忽略服务端可能携带的细节。
    message: kind === 'not_accessible'
      ? DEFAULT_MESSAGE.not_accessible
      : (result && result.message) || DEFAULT_MESSAGE[kind],
    retryable: kind === 'server' || kind === 'rate_limited',
    detail: result && result.detail,
  });
}

function buildTransportError(err) {
  if (err instanceof ApiError) return err;
  const message = (err && (err.errMsg || err.message || err.msg)) || '';
  const isTimeout = /timeout|timed out/i.test(message);
  return new ApiError({
    kind: isTimeout ? 'timeout' : 'network',
    httpStatus: 0,
    message: isTimeout ? DEFAULT_MESSAGE.timeout : DEFAULT_MESSAGE.network,
    retryable: true,
    detail: message,
  });
}

function resolveResponse(body, httpStatus = 200) {
  const result = unwrapResult(body);
  if (httpStatus >= 200 && httpStatus < 300) {
    if (!result || result.code === 0 || result.code === 200 || result.success === true) {
      return result ? result.data : null;
    }
  }
  throw buildError(httpStatus, result);
}

function withTimeout(promise, timeout) {
  if (!timeout || timeout <= 0) return Promise.resolve(promise);
  let timer;
  const timeoutPromise = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new ApiError({
      kind: 'timeout',
      httpStatus: 0,
      message: DEFAULT_MESSAGE.timeout,
      retryable: true,
    })), timeout);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => clearTimeout(timer));
}

function requestCloud(url, { method, data, timeout, clubId }) {
  let call;
  try {
    const { action, payload } = resolveTransport(url, method, data);
    call = wx.cloud.callFunction({
      name: cloudFunctionName,
      data: { action, payload, ...(clubId ? { clubId } : {}) },
    });
  } catch (err) {
    if (err && err.code === 'invalid_input') {
      return Promise.reject(new ApiError({
        kind: 'invalid_input',
        httpStatus: 422,
        code: err.code,
        message: '请求不合法',
        detail: err.message,
      }));
    }
    return Promise.reject(buildTransportError(err));
  }

  return withTimeout(call, timeout)
    .then((res) => {
      const result = res && Object.prototype.hasOwnProperty.call(res, 'result') ? res.result : res;
      return resolveResponse(result, 200);
    })
    .catch((err) => {
      throw buildTransportError(err);
    });
}

function apiUrl(path) {
  const baseUrl = typeof config.apiBaseUrl === 'string' ? config.apiBaseUrl : '';
  const httpsOriginMatch = baseUrl.match(HTTPS_ORIGIN_PATTERN);
  const isHttpsOrigin = Boolean(httpsOriginMatch)
    && httpsOriginMatch[1].length <= 253
    && (!httpsOriginMatch[2] || Number(httpsOriginMatch[2]) <= 65535);
  const isConfiguredLanDevelopmentOrigin = config.profile === 'nasLanDevelopment'
    && baseUrl === 'http://192.168.50.28:18118';
  if (!isHttpsOrigin && !isConfiguredLanDevelopmentOrigin) {
    const code = baseUrl ? 'api_base_url_invalid' : 'api_base_url_missing';
    throw new ApiError({
      kind: 'server',
      httpStatus: 0,
      code,
      message: '服务配置暂不可用',
      detail: 'Set a valid NAS API origin in config.js before selecting the NAS profile.',
    });
  }
  return `${baseUrl}${path}`;
}

function nativeRequest({ url, data, header = {}, timeout = AUTH_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data,
      timeout,
      header: {
        'Content-Type': 'application/json',
        ...header,
      },
      success: resolve,
      fail: reject,
    });
  });
}

function getWechatLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result && typeof result.code === 'string' && result.code) {
          resolve(result.code);
          return;
        }
        reject(new Error('wx.login did not return a code'));
      },
      fail: reject,
    });
  });
}

function exchangeWechatCode(code, timeout, url) {
  return nativeRequest({
    url,
    data: { code },
    timeout,
  }).then((response) => {
    const data = resolveResponse(response && response.data, response && response.statusCode);
    if (!data || typeof data.token !== 'string' || !data.token) {
      throw new ApiError({
        kind: 'server',
        httpStatus: response && response.statusCode,
        code: 'invalid_auth_response',
        message: DEFAULT_MESSAGE.server,
      });
    }
    return data.token;
  });
}

/**
 * 只在内存中持有短时会话 token。冷启动时通过 wx.login 获取一次性 code，
 * 由服务端换取 token；客户端永不提交或推断 OpenID。
 */
export function ensureAuthToken(timeout = AUTH_TIMEOUT_MS) {
  if (authToken) return Promise.resolve(authToken);
  if (authPromise) return authPromise;

  let authUrl;
  try {
    authUrl = apiUrl('/v1/auth/wechat');
  } catch (err) {
    return Promise.reject(err);
  }

  const generation = authGeneration;
  const pending = withTimeout(getWechatLoginCode(), timeout)
    .then((code) => withTimeout(exchangeWechatCode(code, timeout, authUrl), timeout))
    .then((token) => {
      if (generation !== authGeneration) {
        throw new ApiError({
          kind: 'unauthenticated',
          httpStatus: 401,
          code: 'session_changed',
          message: DEFAULT_MESSAGE.unauthenticated,
        });
      }
      authToken = token;
      return authToken;
    })
    .catch((err) => {
      throw buildTransportError(err);
    })
    .finally(() => {
      if (authPromise === pending) authPromise = null;
    });
  authPromise = pending;
  return pending;
}

/** 退出登录或服务端撤权时丢弃凭据，并使尚未完成的登录交换失效。 */
export function clearAuthToken() {
  authGeneration += 1;
  authToken = '';
  authPromise = null;
}

function requestAction(action, payload, { timeout, clubId }) {
  return ensureAuthToken(timeout).then((token) => withTimeout(nativeRequest({
    url: apiUrl('/v1/action'),
    data: { action, payload, ...(clubId ? { clubId } : {}) },
    timeout,
    header: { Authorization: `Bearer ${token}` },
  }), timeout).then((response) => resolveResponse(
    response && response.data,
    response && response.statusCode,
  )));
}

function requestNas(url, { method, data, timeout, clubId }) {
  let transport;
  try {
    transport = resolveTransport(url, method, data);
  } catch (err) {
    if (err && err.code === 'invalid_input') {
      return Promise.reject(new ApiError({
        kind: 'invalid_input',
        httpStatus: 422,
        code: err.code,
        message: '请求不合法',
        detail: err.message,
      }));
    }
    return Promise.reject(buildTransportError(err));
  }
  return requestAction(transport.action, transport.payload, { timeout, clubId })
    .catch((err) => { throw buildTransportError(err); });
}

function independentClubPath(url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path.startsWith('/platform/') || path === '/account/me' || path === '/clubs' || path === '/clubs/mine' || path === '/me/account';
}

function requestContext(url, explicitClubId) {
  const app = typeof getApp === 'function' ? getApp() : null;
  const globalData = app && app.globalData;
  const sessionClubId = globalData && globalData.session && globalData.session.club
    ? globalData.session.club.id
    : '';
  const isIndependent = independentClubPath(url);
  const clubId = explicitClubId || (isIndependent ? '' : sessionClubId) || '';
  if (!clubId && !isIndependent) {
    throw new ApiError({
      kind: 'forbidden',
      httpStatus: 403,
      code: 'club_required',
      message: '请先选择社团',
    });
  }
  if (!explicitClubId && globalData && globalData.clubSwitching && !isIndependent) {
    throw new ApiError({
      kind: 'conflict',
      httpStatus: 409,
      code: 'club_context_changed',
      message: '社团正在切换，请稍后重试',
    });
  }
  return {
    app,
    clubId,
    contextVersion: globalData && globalData.clubContextVersion || 0,
    explicit: !!explicitClubId,
    independent: isIndependent,
    checkCurrent: !!clubId && !explicitClubId,
  };
}

function assertRequestContext(context) {
  const globalData = context.app && context.app.globalData;
  if (!globalData) return;
  if (context.independent) return;
  if (globalData.clubContextVersion !== context.contextVersion) {
    throw new ApiError({
      kind: 'conflict',
      httpStatus: 409,
      code: 'club_context_changed',
      message: '社团已切换，请刷新当前内容',
    });
  }
  if (context.checkCurrent) {
    const currentClubId = globalData.session && globalData.session.club && globalData.session.club.id;
    if (context.clubId && currentClubId !== context.clubId) {
      throw new ApiError({
        kind: 'conflict',
        httpStatus: 409,
        code: 'club_context_changed',
        message: '社团已切换，请刷新当前内容',
      });
    }
  }
}

function executeRequest(url, options, explicitClubId = '') {
  const { method = 'GET', data = {}, timeout = 10000, idempotencyKey } = options;
  let context;
  try {
    context = requestContext(url, explicitClubId);
  } catch (err) {
    return Promise.reject(err);
  }
  const payload = withIdempotency(data, idempotencyKey);
  delete payload.clubId;
  const call = config.transport === 'nas'
    ? requestNas(url, { method, data: payload, timeout, clubId: context.clubId })
    : requestCloud(url, { method, data: payload, timeout, clubId: context.clubId });

  return Promise.resolve(call).then((result) => {
    assertRequestContext(context);
    return result;
  }).catch((err) => {
    const apiError = buildTransportError(err);
    const globalData = context.app && context.app.globalData;
    const contextChanged = !context.independent && globalData
      && globalData.clubContextVersion !== context.contextVersion;
    if (contextChanged && apiError.kind === 'membership_invalid') {
      throw new ApiError({
        kind: 'conflict',
        httpStatus: 409,
        code: 'club_context_changed',
        message: '社团已切换，请刷新当前内容',
      });
    }
    if (apiError.kind === 'unauthenticated') {
      if (config.transport === 'nas') clearAuthToken();
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.invalidateSession) app.invalidateSession();
    } else if (apiError.kind === 'membership_invalid') {
      const app = typeof getApp === 'function' ? getApp() : null;
      const activeClubId = app && app.globalData && app.globalData.session
        && app.globalData.session.club && app.globalData.session.club.id;
      if (app && app.invalidateClubSelection && activeClubId === context.clubId) {
        app.invalidateClubSelection();
      }
    }
    throw apiError;
  });
}

/**
 * @param {string} url 以 / 开头的接口路径
 * @param {object} options { method, data, timeout, idempotencyKey }
 * @returns {Promise<any>} 成功时 resolve 业务 data
 */
export default function request(url, options = {}) {
  return executeRequest(url, options);
}

/** 对加入流程与社团详情显式请求目标社团；权限仍由服务端按目标社团重新计算。 */
export function requestForClub(url, clubId, options = {}) {
  if (typeof clubId !== 'string' || !clubId.trim()) {
    return Promise.reject(new ApiError({
      kind: 'invalid_input',
      httpStatus: 422,
      code: 'club_required',
      message: '社团信息缺失',
    }));
  }
  return executeRequest(url, options, clubId.trim());
}

/** 把 /posts/:id 这类模板路径替换为实际路径 */
export function withPath(template, params = {}) {
  return Object.keys(params).reduce((acc, key) => acc.replace(`:${key}`, encodeURIComponent(params[key])), template);
}

/** 拼接 query，自动跳过 undefined / null / '' */
export function withQuery(url, query = {}) {
  const pairs = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return pairs.length ? `${url}?${pairs.join('&')}` : url;
}

export { DEFAULT_MESSAGE };
