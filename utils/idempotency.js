/**
 * 幂等键：随草稿一起持久化，提交超时后用同一键重试，服务端保证只产生一条内容。
 * 见 docs/04-data-model-and-api.md 4.7。
 */
export function createIdempotencyKey(prefix = 'post') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export default createIdempotencyKey;
