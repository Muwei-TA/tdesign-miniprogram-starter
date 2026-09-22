import { route, fail } from '../WxMock';
import { ME, POSTS, COMMENTS, TOPICS, COLLECTIONS, NOTIFICATIONS, WEEK_PROMPT, CLUB } from './fixtures';
import { formatRelativeTime, excerpt } from '~/utils/format';

/**
 * 社区 Mock 路由。
 * MOCK_ROLE 用于切换视角：'guest' | 'member' | 'admin'。
 * 刻意不做界面开关——角色切换是开发调试手段，不是产品赋予用户的权限。
 */
const MOCK_ROLE = 'member';
let MOCK_APPLICATION = null;

const CAPABILITIES = {
  // 公开发布在 G0 核验完成前保持关闭（docs/01 1.6 / 1.7）
  publicScope: false,
  // 视频链路未验收，保持关闭
  video: false,
  anthology: true,
  export: true,
};

function isMember() {
  return MOCK_ROLE === 'member' || MOCK_ROLE === 'admin';
}

/** 模拟服务端过滤：访客只能看到公开且已发布内容，私密内容任何人都不出现在流里 */
function visibleForFeed(post) {
  if (post.status !== 'published') return false;
  if (post.visibility === 'private') return false;
  if (!isMember() && post.visibility !== 'public') return false;
  return true;
}

function toCardDTO(post) {
  return {
    id: post.id,
    kind: post.kind,
    category: post.category,
    categoryText: post.categoryText,
    title: post.title,
    excerpt: excerpt(post.body, post.kind === 'article' ? 80 : 140),
    createdAtText: formatRelativeTime(post.createdAt),
    visibility: post.visibility,
    identityMode: post.identityMode,
    author: post.author,
    topic: post.topic,
    media: post.media,
    event: post.event || null,
    counters: post.counters,
    viewer: post.viewer,
    status: post.status,
    statusText: post.statusText || null,
  };
}

function toDetailDTO(post) {
  return {
    ...toCardDTO(post),
    body: post.body,
    paragraphs: String(post.body || '')
      .split(/\n{2,}/)
      .filter(Boolean),
    commentsEnabled: post.viewer.canComment,
    version: 1,
    consent: { collectionGranted: false },
    viewer: {
      ...post.viewer,
      canShrinkVisibility: post.viewer.isOwner && post.visibility !== 'private',
      canDelete: post.viewer.isOwner,
      canReport: !post.viewer.isOwner && post.visibility !== 'private',
    },
  };
}

function matchFilter(post, { type, filter }) {
  if (filter === 'awaiting_reply') return post.counters.comments === 0;
  if (!type || type === 'all') return true;
  if (type === 'article') return post.kind === 'article';
  if (type === 'video') return post.media && post.media.type === 'video';
  return post.category === type;
}

export default function registerCommunityMock() {
  // ---------- 会话 ----------
  route('GET /session/me', () => ({
    role: MOCK_ROLE,
    memberStatus: isMember() ? 'active' : 'none',
    user: isMember() ? ME : null,
    capabilities: CAPABILITIES,
    club: CLUB,
  }));

  // ---------- 入社申请 ----------
  // Mock 只模拟状态机，不保存或验证任何真实邀请码；真实校验由后端完成。
  route('GET /membership/applications/mine', () => {
    if (isMember()) return { state: 'active', reason: '', appliedAtText: '' };
    return MOCK_APPLICATION || { state: 'none', reason: '' };
  });

  route('POST /membership/applications', ({ body }) => {
    if (isMember()) return fail(409, 'conflict', '你已经是社内成员');
    if (!body.displayName || !body.inviteCode || !body.rulesVersion) {
      return fail(422, 'invalid_input', '请完整填写申请信息');
    }
    if (MOCK_APPLICATION && MOCK_APPLICATION.state === 'pending') {
      return { state: 'pending', applicationId: 'mock-membership-application' };
    }
    MOCK_APPLICATION = {
      state: 'pending',
      reason: '',
      appliedAtText: '刚刚提交',
    };
    return { state: 'pending', applicationId: 'mock-membership-application' };
  });

  // ---------- 内容流 ----------
  route('GET /posts', ({ query }) => {
    const items = POSTS.filter(visibleForFeed)
      .filter((post) => matchFilter(post, query))
      .filter((post) => !query.topicId || (post.topic && post.topic.id === query.topicId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toCardDTO);
    return { items, nextCursor: null, weekPrompt: WEEK_PROMPT, club: CLUB };
  });

  route('GET /posts/:id', ({ params }) => {
    const post = POSTS.find((item) => item.id === params.id);
    // 无权与不存在返回同一形态，避免探测私密 ID（docs/04 4.6）
    if (!post) return fail(404, 'not_accessible');
    if (post.visibility === 'private' && post.ownerId !== ME.id) return fail(404, 'not_accessible');
    if (!isMember() && post.visibility !== 'public') return fail(404, 'not_accessible');
    return toDetailDTO(post);
  });

  route('GET /posts/:id/comments', ({ params }) => {
    const list = (COMMENTS[params.id] || []).map((comment) => ({
      ...comment,
      createdAtText: formatRelativeTime(comment.createdAt),
      replies: (comment.replies || []).map((reply) => ({
        ...reply,
        createdAtText: formatRelativeTime(reply.createdAt),
      })),
    }));
    return { items: list, nextCursor: null };
  });

  route('POST /posts/:id/comments', ({ body }) => ({
    id: `cm-${Date.now()}`,
    state: 'pending',
    body: body.body,
  }));

  route('POST /posts', ({ body }) => ({
    id: `p-${Date.now()}`,
    version: 1,
    // 仅自己内容不进入审核流程，直接保存
    state: body.visibility === 'private' ? 'private_saved' : 'pending',
  }));

  route('PUT /posts/:id/reaction', () => ({ ok: true }));
  route('DELETE /posts/:id/reaction', () => ({ ok: true }));
  route('PUT /posts/:id/bookmark', () => ({ ok: true }));
  route('DELETE /posts/:id/bookmark', () => ({ ok: true }));
  route('PATCH /posts/:id/visibility', ({ body }) => ({ ok: true, visibility: body.visibility }));
  route('DELETE /posts/:id', () => ({ ok: true }));
  route('POST /reports', () => ({ receiptId: `r-${Date.now()}`, state: 'received' }));

  // ---------- 话题 ----------
  route('GET /topics', ({ query }) => {
    const items = TOPICS.filter((topic) => {
      // 待审核话题只对提交者与管理台可见
      if (topic.status === 'pending' && MOCK_ROLE === 'guest') return false;
      if (!query.category) return true;
      return topic.category === query.category;
    }).map((topic) => ({
      ...topic,
      // 访客不应看到社内参与情况
      statsText: isMember() ? topic.statsText : '',
    }));
    return { items, nextCursor: null };
  });

  route('GET /topics/:id', ({ params }) => {
    const topic = TOPICS.find((item) => item.id === params.id);
    if (!topic) return fail(404, 'not_accessible');
    const items = POSTS.filter(visibleForFeed)
      .filter((post) => post.topic && post.topic.id === topic.id)
      .map(toCardDTO);
    return { topic, items, nextCursor: null };
  });

  route('POST /topics', ({ body }) => ({ id: `t-${Date.now()}`, status: 'pending', title: body.title }));
  route('PUT /topics/:id/follow', () => ({ ok: true }));
  route('DELETE /topics/:id/follow', () => ({ ok: true }));

  // ---------- 文集 ----------
  route('GET /collections', () => ({
    items: COLLECTIONS.filter((item) => isMember() || item.visibility === 'public'),
  }));

  route('GET /collections/:id', ({ params }) => {
    const collection = COLLECTIONS.find((item) => item.id === params.id);
    if (!collection) return fail(404, 'not_accessible');
    const entries = POSTS.filter((post) => post.kind === 'article' && visibleForFeed(post)).map((post, index) => ({
      order: index + 1,
      postId: post.id,
      title: post.title,
      authorText: post.author.isAnonymous ? post.author.alias : post.author.displayName,
      dateText: formatRelativeTime(post.createdAt),
    }));
    return { collection, entries: collection.count ? entries : [] };
  });

  route('POST /collections/:id/submissions', () => ({ state: 'submitted' }));
  route('DELETE /consents/:postId', () => ({ ok: true }));

  // ---------- 消息 ----------
  route('GET /notifications', ({ query }) => {
    const tab = query.tab === 'system' ? 'system' : 'reply';
    const items = NOTIFICATIONS[tab].map((item) => ({
      ...item,
      createdAtText: formatRelativeTime(item.createdAt),
      // 目标失效时用中性占位，不泄露原内容
      title: item.target.accessible ? item.title : '相关内容已不可访问',
      summary: item.target.accessible ? item.summary : '',
    }));
    return { items, nextCursor: null };
  });

  route('POST /notifications/read-all', () => ({ ok: true }));
  route('GET /notifications/unread-count', () => ({
    count: NOTIFICATIONS.reply.concat(NOTIFICATIONS.system).filter((item) => !item.read).length,
  }));

  // ---------- 搜索 ----------
  route('GET /search/suggestions', () => ({
    // 推荐词由编辑维护，不从私密内容自动抽取
    items: ['晚霞', '未完成的灵感', '给三年前的自己', '食堂', '雨'],
  }));

  route('GET /search', ({ query }) => {
    const keyword = (query.q || '').trim();
    if (!keyword) return { items: [], nextCursor: null };

    if (query.scope === 'topic') {
      const items = TOPICS.filter(
        (topic) => topic.status !== 'pending' && (topic.title.includes(keyword) || topic.description.includes(keyword)),
      ).map((topic) => ({ ...topic, statsText: isMember() ? topic.statsText : '' }));
      return { items, nextCursor: null };
    }

    // 先按权限过滤，再匹配；私密内容与匿名帖的真实作者名都不参与检索
    const items = POSTS.filter(visibleForFeed)
      .filter((post) => {
        const inBody = post.body.includes(keyword) || (post.title || '').includes(keyword);
        const authorName = post.author.isAnonymous ? post.author.alias : post.author.displayName;
        return inBody || (authorName || '').includes(keyword);
      })
      .map(toCardDTO);
    return { items, nextCursor: null };
  });

  // ---------- 我的 ----------
  route('GET /me/contents', ({ query }) => {
    const tab = query.tab || 'published';
    const mine = POSTS.filter((post) => post.ownerId === ME.id);
    const map = {
      published: mine.filter((post) => post.status === 'published' && post.visibility !== 'private'),
      pending: mine.filter((post) => post.status === 'pending' || post.status === 'rejected'),
      private: mine.filter((post) => post.visibility === 'private'),
      bookmark: POSTS.filter((post) => post.viewer.bookmarked && visibleForFeed(post)),
    };
    return { items: (map[tab] || []).map(toCardDTO), nextCursor: null };
  });

  route('GET /me/profile', () => ({
    user: ME,
    memberSince: '2026 年 3 月加入',
    stats: { posts: 6, bookmarks: 3, topics: 1 },
  }));

  // ---------- 数据权利异步任务 ----------
  route('POST /me/exports', () => {
    if (!isMember()) return fail(403, 'membership_invalid', '社内内容需要有效的成员资格');
    return { state: 'queued' };
  });

  route('DELETE /me/account', ({ body }) => {
    if (!body || body.confirm !== '注销') return fail(422, 'invalid_input', '请输入「注销」以确认');
    return { state: 'pending' };
  });
}
