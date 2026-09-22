import request, { withPath } from '~/api/request';
import endpoints from '~/api/endpoints';

export function fetchCollections() {
  return request(endpoints.collections);
}

/** 目录实时读取文章状态，不做正文快照（docs/08 P07） */
export function fetchCollectionDetail(id) {
  return request(withPath(endpoints.collectionDetail, { id }));
}

/** 投稿只是申请：安全审核通过 ≠ 被文集选中，且不扩大原文范围 */
export function submitToCollection(id, { postId, consentVersion }) {
  return request(withPath(endpoints.collectionSubmissions, { id }), {
    method: 'POST',
    data: { postId, consentVersion },
  });
}

/** 撤回授权：目录同步移除；已缓存截图无法收回，需在 UI 中告知 */
export function revokeConsent(postId) {
  return request(withPath(endpoints.consent, { postId }), { method: 'DELETE' });
}

export default { fetchCollections, fetchCollectionDetail, submitToCollection, revokeConsent };
