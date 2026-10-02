import { getSession, scopedKey } from '~/services/session';

function legacyKey(name) {
  const userId = getSession().user && getSession().user.id;
  return userId ? `hg:${userId}:${name}` : '';
}

function isHeiguangMember() {
  const session = getSession();
  return !!session.user && session.memberStatus === 'active' && session.club && session.club.id === 'heiguang';
}

export function migrateLegacyDraft(id) {
  if (!isHeiguangMember()) return null;
  const storageKey = scopedKey(`draft:${id}`);
  const current = wx.getStorageSync(storageKey);
  if (current) return current;
  const draft = wx.getStorageSync(legacyKey(`draft:${id}`));
  if (!draft || (draft.clubId && draft.clubId !== 'heiguang')) return null;
  const migrated = { ...draft, clubId: 'heiguang' };
  wx.setStorageSync(storageKey, migrated);
  const indexKey = scopedKey('draft-index');
  const index = wx.getStorageSync(indexKey) || [];
  const oldIndex = wx.getStorageSync(legacyKey('draft-index')) || [];
  const entry = oldIndex.find((item) => item.id === id) || {
    id,
    kind: migrated.kind,
    title: migrated.title || '',
    excerpt: (migrated.body || '').slice(0, 40),
    updatedAt: migrated.updatedAt || 0,
  };
  wx.setStorageSync(indexKey, [entry, ...index.filter((item) => item.id !== id)]);
  return migrated;
}

export function migrateLegacyDraftIndex() {
  if (!isHeiguangMember()) return wx.getStorageSync(scopedKey('draft-index')) || [];
  const indexKey = scopedKey('draft-index');
  const merged = [];
  const seen = new Set();
  (wx.getStorageSync(indexKey) || []).forEach((item) => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });
  const oldIndex = wx.getStorageSync(legacyKey('draft-index')) || [];
  oldIndex.forEach((item) => {
    if (!item || !item.id || seen.has(item.id)) return;
    const draft = wx.getStorageSync(scopedKey(`draft:${item.id}`)) || migrateLegacyDraft(item.id);
    if (!draft) return;
    seen.add(item.id);
    merged.push(item);
  });
  wx.setStorageSync(indexKey, merged);
  return merged;
}

export function removeLegacyDraft(id) {
  if (!isHeiguangMember()) return;
  wx.removeStorageSync(legacyKey(`draft:${id}`));
  const key = legacyKey('draft-index');
  wx.setStorageSync(key, (wx.getStorageSync(key) || []).filter((item) => item.id !== id));
}

export default { migrateLegacyDraft, migrateLegacyDraftIndex, removeLegacyDraft };
