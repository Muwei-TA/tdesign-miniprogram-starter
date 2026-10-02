import request, { clearAuthToken, requestForClub } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 会话与成员状态的唯一来源。
 * 重要：能力开关读取失败时按"全部关闭"处理（fail-closed），见 docs/01 1.6。
 */

const GUEST_SESSION = {
  platformRole: 'none',
  role: 'guest',
  memberStatus: 'none',
  user: null,
  club: null,
  capabilities: {
    publishing: false,
    uploads: false,
    publicScope: false,
    video: false,
    anthology: false,
    export: false,
  },
};

let current = { ...GUEST_SESSION };
let sessionRequestVersion = 0;

function normalize(payload) {
  if (!payload) return { ...GUEST_SESSION };
  return {
    platformRole: payload.platformRole === 'developer' ? 'developer' : 'none',
    role: payload.role || 'guest',
    memberStatus: payload.memberStatus || 'none',
    user: payload.user || null,
    club: payload.club || null,
    capabilities: {
      publishing: false,
      uploads: false,
      publicScope: false,
      video: false,
      anthology: false,
      export: false,
      ...(payload.capabilities || {}),
    },
  };
}

async function loadSession({ failClosed, endpoint = endpoints.sessionMe }) {
  sessionRequestVersion += 1;
  const requestVersion = sessionRequestVersion;
  try {
    const payload = await request(endpoint);
    if (requestVersion === sessionRequestVersion) current = normalize(payload);
  } catch (err) {
    if (!failClosed) throw err;
    if (requestVersion === sessionRequestVersion) current = { ...GUEST_SESSION };
  }
  return current;
}

export function fetchInitialSession() {
  return request(endpoints.accountMe).then(normalize);
}

export function refreshSessionForClub(clubId) {
  return requestForClub(endpoints.sessionMe, clubId).then(normalize);
}

export function setCurrentSession(session) {
  sessionRequestVersion += 1;
  current = normalize(session);
  return current;
}

export function setSessionWithoutClub(session) {
  sessionRequestVersion += 1;
  current = {
    ...normalize(session),
    role: 'guest',
    memberStatus: 'none',
    club: null,
    capabilities: {
      publishing: false,
      uploads: false,
      publicScope: false,
      video: false,
      anthology: false,
      export: false,
    },
  };
  return current;
}

/** 冷启动恢复会话；任何失败都降级为访客，不抛出以避免阻塞启动 */
export function bootstrapSession() {
  return loadSession({ failClosed: true, endpoint: endpoints.accountMe });
}

/** 页面重新显示时向服务端刷新；网络错误保留最后一次会话并交由页面显示错误态 */
export function refreshSessionFromServer() {
  return loadSession({ failClosed: false });
}

export function getSession() {
  return current;
}

export function getCapabilities() {
  return current.capabilities;
}

export function isMember() {
  return current.memberStatus === 'active';
}

export function isAdmin() {
  return current.role === 'admin' || current.role === 'moderator';
}

/**
 * 保留旧调用名以兼容页面。NAS profile 在传输层使用 wx.login code 建立会话；
 * CloudBase profile 继续使用微信自动注入的调用上下文。
 */
export async function loginWithWechat() {
  return bootstrapSession();
}

/**
 * 清理账号作用域缓存：退出登录 / membership_invalid 时必须调用。
 * 见 docs/05 5.6 的前端硬性检查清单。
 */
export function clearAccountScope() {
  // 使正在进行的旧会话读取失效，防止退出或撤权后旧响应重新写回成员态。
  sessionRequestVersion += 1;
  clearAuthToken();
  const userId = current.user && current.user.id;
  try {
    const { keys } = wx.getStorageInfoSync();
    keys
      .filter((key) => userId && key.startsWith(`hg:${userId}:`))
      .forEach((key) => wx.removeStorageSync(key));
  } catch (err) {
    // storage 读取失败时保持内存态切换为访客；下次启动会重新建立账号作用域。
  }
  current = { ...GUEST_SESSION };
  return current;
}

/** 账号作用域的 storage key，防止上一账号数据留给下一账号 */
export function scopedKey(name) {
  const app = typeof getApp === 'function' ? getApp() : null;
  const scope = app && app.globalData ? app.globalData.session : current;
  const userId = (scope && scope.user && scope.user.id) || 'guest';
  const clubId = (scope && scope.club && scope.club.id) || 'none';
  return `hg:${userId}:${clubId}:${name}`;
}

export default {
  fetchInitialSession,
  refreshSessionForClub,
  setCurrentSession,
  setSessionWithoutClub,
  bootstrapSession,
  refreshSessionFromServer,
  getSession,
  getCapabilities,
  isMember,
  isAdmin,
  loginWithWechat,
  clearAccountScope,
  scopedKey,
};
