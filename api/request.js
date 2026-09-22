import config from '~/config';

const { baseUrl } = config;
const SESSION_TOKEN_KEY = 'hg:session-token';

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
  if (bodyCode === 'membership_invalid' || bodyCode === 'pending_media') return bodyCode;
  if (KIND_BY_HTTP[httpStatus]) return KIND_BY_HTTP[httpStatus];
  if (httpStatus >= 500) return 'server';
  return 'server';
}

function buildError(httpStatus, body) {
  const bodyCode = body && body.code;
  const kind = resolveKind(httpStatus, bodyCode);
  return new ApiError({
    kind,
    httpStatus,
    code: bodyCode,
    // not_accessible 强制统一文案，忽略服务端可能携带的细节
    message: kind === 'not_accessible' ? DEFAULT_MESSAGE.not_accessible : (body && body.message) || DEFAULT_MESSAGE[kind],
    retryable: kind === 'server' || kind === 'rate_limited',
    detail: body && body.detail,
  });
}

/**
 * @param {string} url 以 / 开头的接口路径
 * @param {object} options { method, data, header, timeout, idempotencyKey }
 * @returns {Promise<any>} 成功时 resolve 业务 data
 */
export default function request(url, options = {}) {
  const { method = 'GET', data = {}, header = {}, timeout = 10000, idempotencyKey } = options;

  const finalHeader = {
    'content-type': 'application/json',
    ...header,
  };

  const token = wx.getStorageSync(SESSION_TOKEN_KEY);
  if (token) finalHeader.Authorization = `Bearer ${token}`;
  if (idempotencyKey) finalHeader['Idempotency-Key'] = idempotencyKey;

  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + url,
      method,
      data,
      timeout,
      dataType: 'json',
      header: finalHeader,
      success(res) {
        const { statusCode, data: body } = res;
        // 先判 HTTP 状态，再判业务 code（模板原实现用 res.code 属缺陷）
        if (statusCode >= 200 && statusCode < 300) {
          if (!body || body.code === 0 || body.code === 200 || body.success === true) {
            resolve(body ? body.data : null);
            return;
          }
          reject(buildError(statusCode, body));
          return;
        }
        reject(buildError(statusCode, body));
      },
      fail(err) {
        const isTimeout = /timeout/i.test(err.errMsg || '');
        reject(
          new ApiError({
            kind: isTimeout ? 'timeout' : 'network',
            httpStatus: 0,
            message: isTimeout ? DEFAULT_MESSAGE.timeout : DEFAULT_MESSAGE.network,
            retryable: true,
            detail: err.errMsg,
          }),
        );
      },
    });
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

export { SESSION_TOKEN_KEY, DEFAULT_MESSAGE };
