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

function resolveKind(httpStatus, bodyCode) {
  // 业务码优先：后端可用 code 细分 membership_invalid / pending_media 等
  if (bodyCode && HTTP_BY_KIND[bodyCode]) return bodyCode;
  if (KIND_BY_HTTP[httpStatus]) return KIND_BY_HTTP[httpStatus];
  if (httpStatus >= 500) return 'server';
  return 'server';
}

function buildError(httpStatus, body) {
  const bodyCode = body && body.code;
  const kind = resolveKind(httpStatus, bodyCode);
  return new ApiError({
    kind,
    httpStatus: httpStatus || HTTP_BY_KIND[kind] || 0,
    code: bodyCode,
    // not_accessible 强制统一文案，忽略服务端可能携带的细节
    message: kind === 'not_accessible' ? DEFAULT_MESSAGE.not_accessible : (body && body.message) || DEFAULT_MESSAGE[kind],
    retryable: kind === 'server' || kind === 'rate_limited',
    detail: body && body.detail,
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

function requestCloud(url, { method, data, timeout }) {
  let call;
  try {
    const { action, payload } = resolveTransport(url, method, data);
    call = wx.cloud.callFunction({
      name: cloudFunctionName,
      data: { action, payload },
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

/**
 * @param {string} url 以 / 开头的接口路径
 * @param {object} options { method, data, timeout, idempotencyKey }
 * @returns {Promise<any>} 成功时 resolve 业务 data
 */
export default function request(url, options = {}) {
  const { method = 'GET', data = {}, timeout = 10000, idempotencyKey } = options;
  const payload = withIdempotency(data, idempotencyKey);
  return requestCloud(url, { method, data: payload, timeout }).catch((err) => {
    if (err.kind === 'unauthenticated' || err.kind === 'membership_invalid') {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.invalidateSession) app.invalidateSession();
    }
    throw err;
  });
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
