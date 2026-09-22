/**
 * 接口路径常量，契约见 docs/04-data-model-and-api.md
 * 路径中的 :id 由调用方替换。
 */
export default {
  sessionWechat: '/session/wechat',
  sessionMe: '/session/me',

  membershipApply: '/membership/applications',
  membershipMine: '/membership/applications/mine',

  posts: '/posts',
  postDetail: '/posts/:id',
  postVisibility: '/posts/:id/visibility',
  postReaction: '/posts/:id/reaction',
  postBookmark: '/posts/:id/bookmark',
  postComments: '/posts/:id/comments',

  topics: '/topics',
  topicDetail: '/topics/:id',
  topicFollow: '/topics/:id/follow',

  collections: '/collections',
  collectionDetail: '/collections/:id',
  collectionSubmissions: '/collections/:id/submissions',
  consent: '/consents/:postId',

  notifications: '/notifications',
  notificationsReadAll: '/notifications/read-all',
  notificationsUnread: '/notifications/unread-count',

  search: '/search',
  searchSuggestions: '/search/suggestions',

  uploadIntents: '/assets/upload-intents',
  assetDetail: '/assets/:id',

  reports: '/reports',

  adminQueue: '/admin/queues/:queue',
  adminDecision: '/admin/reviews/:id/decision',
  adminMemberDecision: '/admin/members/applications/:id',

  myContents: '/me/contents',
  myExports: '/me/exports',
  myAccount: '/me/account',
};
