# 02｜前端架构与工程规范

> 基线：原生微信小程序 + TDesign MiniProgram，JS（非 TS），LESS。最低基础库 `^2.6.5`，
> 开发者工具 libVersion 以 `project.config.json` 为准。**不引入新依赖。**

## 2.1 分层职责

```text
pages/            页面：界面状态、导航、事件编排、错误展示
components/       组件：纯展示 + 事件抛出，禁止直接请求数据、禁止判断业务权限
services/         用例层：组合接口、DTO→ViewModel 转换、本地草稿、能力开关缓存
api/              传输层：URL、超时、会话头、HTTP/业务错误映射（不含业务规则）
mock/             Mock 数据与拦截，仅在 config.isMock 为真时装载
utils/            纯函数工具（时间、字符串、事件总线、幂等键）
styles/           设计令牌与 mixin（tokens.less / mixins.less）
```

**硬规则**

1. `components/**` 不允许 `import request`、不允许 `wx.request`、不允许读 `wx.getStorageSync('session')`。
2. `services/**` 不允许 `wx.navigateTo`（导航属于页面层）。
3. `api/request.js` 不允许出现 `visibility`、`role`、`isMember` 等业务判断。
4. 任何"是否可见/是否可评论"最终由服务端返回字段决定，前端只按字段渲染，不自己推断。

## 2.2 目录结构（目标态）

```text
api/
  request.js              # 统一请求（已存在，需按 04 章契约改造）
  endpoints.js            # 新增：接口路径常量
services/
  session.js              # 会话、成员状态、capabilities
  posts.js                # 内容流、详情、发布、范围变更、互动
  topics.js               # 话题列表/详情/提交/关注
  collections.js          # 文集列表/目录/投稿授权
  notifications.js        # 站内消息
  search.js               # 权限内搜索
  moderation.js           # 管理台五队列
  drafts.js               # 本地草稿（账号作用域）
  uploads.js              # 上传意图 + 分步上传 + 失败重试
components/
  hg-nav/                 # 自定义导航栏（纸感）
  post-card/              # 内容卡（碎片/文章/视频/活动）
  visibility-badge/       # 范围标识
  identity-label/         # 署名/树洞身份标签（含匿名说明入口）
  media-preview/          # 图片组 / 视频占位
  topic-card/             # 话题卡
  collection-cover/       # 书脊式文集封面
  comment-list/           # 评论 + 定向回复
  empty-state/            # 空态
  request-state/          # 加载/失败/重试
  scope-picker/           # 范围选择弹层
  moderation-item/        # 管理台条目
pages/
  home/                   # P01 树洞
  topics/                 # P02 话题广场
  anthology/              # P06 文集
  my/                     # P09 我的
  message/                # P08 消息中心
  release/                # P04 写一笔
  search/                 # P11 搜索
  community/              # 分包：详情与配套页
    post/                 # P05 内容详情 / 长文
    topic/                # P03 话题详情
    collection/           # P07 文集目录
    my-content/           # P10 我的内容列表
    club/                 # P14 社团名片
    join/                 # P12 加入文学社
    rules/                # P16 社区约定
    result/               # P17 发布结果
    profile/              # P18 社员主页
  setting/                # P13 设置与隐私
  admin/                  # 分包：P15 管理台
styles/
  tokens.less             # 设计令牌（唯一色值/字号来源）
  mixins.less             # 常用 mixin
```

被移除：`pages/chat`、`pages/loginCode`、`pages/dataCenter`、`mock/chat.js`、`mock/dataCenter/`、
`components/card`（被 `post-card` 取代）。移除前必须用 `search_content` 确认无引用。

## 2.3 请求层契约（`api/request.js` 改造要求）

```js
// 目标签名
request(url, { method = 'GET', data, header, timeout = 10000, idempotencyKey })
  -> Promise<payload>           // 成功直接 resolve 业务 data
  -> Promise.reject(ApiError)   // 失败统一 ApiError
```

要求：

1. **先看 HTTP 状态**（`res.statusCode`），再看业务 `code`；现模板用 `res.code === 200` 属缺陷，必须修正。
2. 统一注入会话头：`Authorization: Bearer <sessionToken>`，token 从 `services/session.js` 取，
   不在 `request.js` 里直接读 storage 以外的业务态。
3. 幂等：`POST /posts`、`POST /comments` 必须带 `Idempotency-Key`，由 `utils/idempotency.js` 生成并随草稿持久化。
4. `ApiError` 结构：

```js
{ kind, httpStatus, code, message, retryable, detail }
// kind ∈ 'unauthenticated' | 'membership_invalid' | 'forbidden' | 'not_accessible'
//        | 'invalid_input' | 'conflict' | 'pending_media' | 'rate_limited'
//        | 'network' | 'timeout' | 'server'
```

5. `not_accessible` 必须统一文案，**不得**通过不同错误文本暴露某条私密内容是否存在。
6. 401/`membership_invalid`：清理账号作用域缓存 → 切换访客态 → 由页面层决定是否跳 P12。

## 2.4 服务层规范

- 每个 service 导出**用例函数**，命名 `动词 + 名词`：`fetchFeed`、`submitPost`、`shrinkVisibility`。
- 返回**ViewModel**（已格式化时间、已拼好标签文案），页面不做二次业务转换。
- 列表统一游标结构：

```js
{ items: [...], nextCursor: 'xxx' | null, hasMore: true }
```

- 本地缓存键必须带账号作用域：`hg:{userId}:draft:{draftId}`；退出登录/成员失效时按前缀清理。
- `capabilities` 缓存 ≤ 5 分钟，读取失败按全部关闭处理。

## 2.5 页面规范

- 每页必须实现三态：`loading` / `error(可重试)` / `empty`，由 `request-state` + `empty-state` 承接。
- 列表页保留滚动位置：Tab 页用 `onShow` 不重置 `scrollTop`；详情返回不 `reLaunch`。
- **禁止** `wx.reLaunch` 作为常规返回（模板 `release` 页现用 `reLaunch`，必须改为 `navigateBack` + 结果页）。
- 需要登录/成员资格的动作：先查 `session.requireMember()`，未通过则弹说明并引导 P12，不静默失败。
- 所有 `setData` 尽量局部路径更新（`this.setData({ ['list[3].reacted']: true })`），避免整列表重渲染。

## 2.6 命名与代码风格

- 文件/目录：kebab-case（`post-card`）；JS 变量：camelCase；常量：UPPER_SNAKE。
- 组件 class 前缀 `hg-`，内部 BEM：`hg-post-card__title--muted`。
- 事件名：`bind:tapbody`、`bind:tapmedia`、`bind:react`、`bind:bookmark`、`bind:taptopic`、`bind:tapauthor`。
- LESS：只允许从 `styles/tokens.less` 取值，不允许在页面内写裸色值（评审会驳回）。
- 注释：业务规则用中文注释说明**为什么**（尤其权限与文案约束），不写"这里设置数据"这类废话。
- ESLint/Prettier 沿用仓库配置，提交前 `npm run lint`。

## 2.7 后端建议（供后端智能体参考）

单部署单元、模块化单体：`controllers → application services → domain/policies → repositories`。
鉴权规则只有一份实现，客户端与后台任务共用。异步任务（审核、转码、通知、清理）
用任务表 + 可重试；回调需验签、去重、防旧覆盖新。详见 `04` 与 `05`。
