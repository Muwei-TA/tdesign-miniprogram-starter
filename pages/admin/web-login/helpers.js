const QR_PREFIX = 'blacklight-admin:';

function isAllowedOrigin(value) {
  return typeof value === 'string'
    && (/^https:\/\/[a-z0-9.-]+(?::[1-9]\d{0,4})?$/i.test(value)
      || /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}$/i.test(value));
}

export function parseWebLoginQr(value) {
  if (typeof value !== 'string' || !value.startsWith(QR_PREFIX)) return '';
  const id = value.slice(QR_PREFIX.length);
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : '';
}

export function createWebLoginFlow({ fetchInfo, approve, reject }) {
  const state = { id: '', info: null, status: 'idle', busy: false, error: '' };

  async function scan(value) {
    const id = parseWebLoginQr(value);
    if (!id) throw new Error('二维码格式不正确，请扫描管理 Web 页面上的登录码。');
    state.id = id;
    state.info = null;
    state.status = 'checking';
    state.error = '';
    const result = await fetchInfo(id);
    if (!result || result.id !== id || !['pending', 'approved', 'rejected', 'expired'].includes(result.status)
      || !isAllowedOrigin(result.origin)) {
      state.status = 'invalid';
      throw new Error('登录事务信息无效或已过期。');
    }
    state.info = {
      id: result.id,
      status: result.status,
      origin: result.origin,
      expiresAt: result.expiresAt || '',
    };
    state.status = result.status;
    return state;
  }

  async function decide(decision) {
    if (!state.id || state.status !== 'pending' || state.busy || !['approve', 'reject'].includes(decision)) {
      throw new Error('这次登录请求已不能处理。');
    }
    state.busy = true;
    try {
      await (decision === 'approve' ? approve(state.id) : reject(state.id));
      state.status = decision === 'approve' ? 'approved' : 'rejected';
      return state;
    } finally {
      state.busy = false;
    }
  }

  function clear() {
    state.id = '';
    state.info = null;
    state.status = 'idle';
    state.busy = false;
    state.error = '';
    return state;
  }

  return { state, scan, decide, clear };
}

export function describeApprovalScope(session) {
  const user = session && session.user;
  const account = user
    ? `${user.displayName || '已登录账号'} · ${user.id || '账号已验证'}`
    : '请先完成小程序账号登录';
  let role = '本账号当前可用身份';
  if (session && session.platformRole === 'developer') role = '平台开发者身份及本账号当前社团身份';
  else if (session && session.club && session.memberStatus === 'active') {
    if (session.role === 'moderator') role = '当前社团负责人身份';
    else if (session.role === 'admin') role = '当前社团审核管理员身份';
    else role = '本账号当前社团身份';
  }
  return {
    account,
    scope: `只建立 Web 登录会话。后续每项操作仍由服务端按${role}和实时权限逐次判定，不会新增任何社团或平台权限。`,
  };
}
