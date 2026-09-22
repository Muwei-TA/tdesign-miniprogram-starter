/**
 * 运行环境配置。
 *
 * Mock 只在开发者明确把 isMock 改为 true 时装载；默认连接 CloudBase api 云函数。
 * baseUrl 仅供 Mock 保留 HTTP 风格路径，不参与真实 CloudBase 调用。
 */
export default {
  isMock: false,
  env: 'shudong-d4g4blap4a5069a28',
  cloudFunctionName: 'api',
  traceUser: true,
  baseUrl: '',
};
