import request, { SESSION_TOKEN_KEY } from '~/api/request';
import endpoints from '~/api/endpoints';

/**
 * 会话与成员状态的唯一来源。
 * 重要：能力开关读取失败时按"全部关闭"处理（fail-closed），见 docs/01 1.6。
 */

const GUEST_SESSION = {
  role: 'guest',
  memberStatus: 'none',
  user: null,
  capabilities: {
    publicScope: false,
    video: false,
    anthology: false,
    export: false,
  },
};

let current = { ...GUEST_SESSION };

function normalize(payload) {
  if (!payload) return { ...GUEST_SESSION };
  return {
    role: payload.role || 'guest',
    memberStatus: payload.memberStatus || 'none',
    user: payload.user || null,
    capabilities: {
      publicScope: false,
      video: false,
      anthology: false,
      export: false,
      ...(payload.capabilities || {}),
    },
  };
}

/** 冷启动恢复会话；任何失败都降级为访客，不抛出以避免阻塞启动 */
export async function bootstrapSession() {
  try {
    const payload = await request(endpoints.sessionMe);
    current = normalize(payload);
  } catch (err) {
    current = { ...GUEST_SESSION };
  }
  return current;
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

/** 微信登录换取后端会话；平台密钥只在服务端使用 */
export async function loginWithWechat(code) {
  const payload = await request(endpoints.sessionWechat, { method: 'POST', data: { code } });
  if (payload && payload.sessionToken) {
    wx.setStorageSync(SESSION_TOKEN_KEY, payload.sessionToken);
  }
  current = normalize(payload);
  return current;
}

/**
 * 清理账号作用域缓存：退出登录 / membership_invalid 时必须调用。
 * 见 docs/05 5.6 的前端硬性检查清单。
 */
export function clearAccountScope() {
  const userId = current.user && current.user.id;
  try {
    const { keys } = wx.getStorageInfoSync();
    keys
      .filter((key) => key === SESSION_TOKEN_KEY || (userId && key.startsWith(`hg:${userId}:`)))
      .forEach((key) => wx.removeStorageSync(key));
  } catch (err) {
    // storage 读取失败时至少移除会话票据
    wx.removeStorageSync(SESSION_TOKEN_KEY);
  }
  current = { ...GUEST_SESSION };
  return current;
}

/** 账号作用域的 storage key，防止上一账号数据留给下一账号 */
export function scopedKey(name) {
  const userId = (current.user && current.user.id) || 'guest';
  return `hg:${userId}:${name}`;
}

export default {
  bootstrapSession,
  getSession,
  getCapabilities,
  isMember,
  isAdmin,
  loginWithWechat,
  clearAccountScope,
  scopedKey,
};
