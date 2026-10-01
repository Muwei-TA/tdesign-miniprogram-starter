/**
 * 运行环境配置。默认仍使用当前在线的 CloudBase API。
 * NAS 局域网 profile 仅供微信开发者工具联调；生产 HTTPS profile 等域名与白名单就绪后再填。
 */
const profiles = {
  cloudbase: {
    transport: 'cloudbase',
    env: 'shudong-d4g4blap4a5069a28',
    cloudFunctionName: 'api',
    traceUser: true,
  },
  nasLanDevelopment: {
    transport: 'nas',
    apiBaseUrl: 'http://192.168.50.28:18118',
  },
  nasProduction: {
    transport: 'nas',
    apiBaseUrl: '',
  },
};

const activeProfile = 'cloudbase';

export default {
  profile: activeProfile,
  ...profiles[activeProfile],
};
