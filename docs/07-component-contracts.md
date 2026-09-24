# 07｜组件契约

> 通用原则：组件**只渲染入参、只抛事件**。禁止在组件内请求数据、判断业务权限、跳转页面。
> 图片预览统一由页面调用 `services/image-preview.js`（`wx.previewImage` 仅传服务端授权 URL）。
> 所有组件放 `components/<name>/`，`index.json` 中 `"component": true`。

## 7.1 组件总览

| 组件 | 目录 | 状态 | 负责任务 |
|---|---|---|---|
| `hg-nav` | `components/hg-nav` | ✅ 已实现 | 基线 |
| `post-card` | `components/post-card` | ✅ 已实现 | 基线 |
| `visibility-badge` | `components/visibility-badge` | ✅ 已实现 | 基线 |
| `topic-card` | `components/topic-card` | ✅ 已实现 | 基线 |
| `collection-cover` | `components/collection-cover` | ✅ 已实现 | 基线 |
| `empty-state` | `components/empty-state` | ✅ 已实现 | 基线 |
| `scope-picker` | `components/scope-picker` | ✅ 已实现 | 基线 |
| `identity-label` | `components/identity-label` | ⬜ 待实现 | T-02 |
| `comment-list` | `components/comment-list` | ⬜ 待实现 | T-06 |
| `request-state` | `components/request-state` | ⬜ 待实现 | T-02 |
| `moderation-item` | `components/moderation-item` | ⬜ 待实现 | T-13 |

## 7.2 `hg-nav`（自定义导航栏）

```text
properties:
  title:        String   页面标题
  showBack:     Boolean  是否显示返回（默认 true，Tab 页传 false）
  variant:      String   'plain' | 'search'  search 时右侧显示搜索入口
  tools:        Array    [{ key, icon, badge:Boolean, label }] 右侧工具
  theme:        String   'paper'(默认) | 'transparent' | 'dark'(长文夜间)
events:
  bind:back        无载荷
  bind:tooltap     { key }
  bind:searchtap   无载荷
```

行为：自动读取状态栏高度并撑高；`showBack` 为 true 时优先 `navigateBack`，栈空则 `switchTab` 到树洞。

## 7.3 `post-card`（内容卡）

```text
properties:
  post:        Object   PostCardDTO（见 04 章）
  mode:        String   'feed'(默认) | 'compact' | 'mine'
  showActions: Boolean  默认 true；private 内容与 mine 模式下由页面传 false
events:
  bind:tapbody    { id }              // 进入详情
  bind:tapmedia   { id, index, type } // 图片放大 / 视频播放
  bind:taptopic   { topicId }
  bind:tapauthor  { userId | null, isAnonymous }
  bind:react      { id, next: Boolean }
  bind:bookmark   { id, next: Boolean }
  bind:more       { id }
```

**硬约束**

1. `post.author.isAnonymous === true` 时：头像用匿名样式、显示 `alias`，`tapauthor` 载荷 `userId = null`。
2. `post.visibility === 'private'`：不渲染共鸣/评论/收藏/更多分享入口。
3. `post.status !== 'published'`：渲染状态标签（`statusText`），且不渲染互动区。
4. 共鸣/收藏按钮必须用 `catchtap` 阻止冒泡到 `tapbody`。
5. 组件内**不得**出现 `visibility === 'club' ? ... : ...` 之外的权限推断（范围标识仅作展示）。
6. 视频：`media.video.ready === false` 时显示"正在处理"，不显示播放按钮。

## 7.4 `visibility-badge`

```text
properties:
  scope:  String  'public' | 'club' | 'private'
  size:   String  'sm'(默认) | 'md'
  withText: Boolean 默认 true
```

映射：`public → 公开可见 / earth 图标`、`club → 仅社内可见 / usergroup`、
`private → 只有自己可见 / lock-on`。**禁止**只显示图标（`withText=false` 仅允许在空间极限处使用，
且必须配 `aria-label`）。

## 7.5 `identity-label`（T-02）

```text
properties:
  identityMode: String 'named' | 'anonymous'
  displayName:  String
  alias:        String
  isAuthor:     Boolean  评论区中标记"作者"
events:
  bind:tapname  { userId | null, isAnonymous }
  bind:explain  无载荷  // 匿名时点击触发说明弹层
```

匿名态点击**只触发** `explain`，不触发 `tapname`。

## 7.6 `media-preview`（已移除）

该组件已随 T-F09 删除：媒体渲染由 `post-card` 与页面层直接完成，
图片预览统一走 `services/image-preview.js`（`wx.previewImage` 仅传服务端授权 URL）。
历史规格见 `11-task-board.md` T-02 与 `frontend-task-audit-2026-09-23.md`。

## 7.7 `topic-card`

```text
properties:
  topic: Object { id, title, description, category, icon, statsText, followed, status }
  mode:  String 'list'(默认) | 'banner'
events:
  bind:tap    { id }
  bind:follow { id, next: Boolean }
```

`status === 'pending'` 显示"待审核"标签且禁用 `follow`；`archived` 显示"已归档"。
访客态由页面层传入不含 `statsText` 的对象（服务端已不返回），组件不自行隐藏。

## 7.8 `collection-cover`

```text
properties:
  collection: Object { id, title, subtitle, no, visibility, tone: 'green'|'cream', count }
  size:       String 'grid'(默认) | 'hero'
events:
  bind:tap { id }
```

书脊式封面：左侧深色书脊、右下装饰圆环、序号用衬线小字。必须显示 `visibility-badge`。

## 7.9 `comment-list`（T-06）

```text
properties:
  comments: Array  [{ id, author:{...}, body, createdAtText, replies: [...], status }]
  canComment: Boolean
  placeholder: String
events:
  bind:reply   { commentId, authorLabel }
  bind:submit  { body, replyToId }
```

一级评论 + 定向回复，**不无限嵌套**。`status === 'pending'` 的自己评论显示"等待审核"。
`canComment = false` 时隐藏输入区并显示原因（作者已关闭回应 / 无成员资格）。

## 7.10 `empty-state`

```text
properties:
  icon:    String  TDesign 图标名
  title:   String
  desc:    String  支持 \n 换行
  action:  String  按钮文案，空则不显示
  variant: String  'default' | 'inline'
events:
  bind:action
```

## 7.11 `request-state`（T-02）

```text
properties:
  state:    String 'idle' | 'loading' | 'error' | 'empty'
  errorKind: String ApiError.kind
  stale:    Boolean 是否保留旧数据（显示"未更新"提示条）
events:
  bind:retry
```

`error` 时**保留已加载数据**，只在顶部展示提示条；不做整页白屏。

## 7.12 `scope-picker`（范围选择弹层）

```text
properties:
  visible:      Boolean
  value:        String  'public' | 'club' | 'private'
  allowPublic:  Boolean  来自 capabilities.publicScope
  mode:         String  'create'(默认) | 'shrink'
events:
  bind:change  { value }
  bind:close
```

规则：
1. `allowPublic = false` 时不渲染 public 选项，并在底部说明"公开发布尚未开放"。
2. `mode = 'shrink'` 时仅显示比当前更小的范围，且选择后由页面弹二次确认。
3. 每个选项必须带一行解释文案（取 `05.7` 文案基线）。

## 7.13 `moderation-item`（T-13）

```text
properties:
  item: Object { id, queue, title, summary, submittedAtText, statusText, meta }
  actions: Array [{ key, label, theme }]
events:
  bind:action { key, id }
  bind:detail { id }
```

要求：显示来源与当前状态；退回/隐藏动作必须由页面弹出"填写理由"弹层后再提交。
组件不得展示匿名映射、私密手记与举报人身份。
