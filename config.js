/**
 * 运行环境配置。
 * isMock=true 时装载 mock/ 拦截 wx.request；接后端时改为 false 并填 baseUrl（任务 T-17）。
 */
export default {
  isMock: true,
  baseUrl: '',
};
