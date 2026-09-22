# T-17 传输层联调说明

前端继续保留 service 使用的 HTTP 风格路径，真实网络由统一传输层转换为 CloudBase `api` 云函数调用。页面和 `services/posts.js` 不需要感知 CloudBase action，也不需要持有会话 token。

## 运行模式

`config.js` 默认使用真实 CloudBase：

```js
{
  isMock: false,
  env: 'shudong-d4g4blap4a5069a28',
  cloudFunctionName: 'api',
  traceUser: true,
}
```

应用启动时调用一次 `wx.cloud.init`。`appid` 由 `project.config.json` 固定为 `wx39773ed34aa30776`。小程序身份由微信自动注入云函数上下文，前端不调用 `/session/wechat` 换 token，不读写 `Authorization: Bearer`。

Mock 只用于明确的开发预览：临时把 `isMock` 改为 `true`，应用才会装载 `mock/` 并继续使用 `wx.request` 路径拦截。提交联调代码时应恢复为 `false`。

## Endpoint 到 action 的转换

`api/transport.js` 负责路径匹配、路径参数解码、query/body 合并，以及需要转换的 DTO 字段：

| 旧 endpoint | 方法 | CloudBase action | payload 关键字段 |
|---|---:|---|---|
| `/session/me` | GET | `session/me` | — |
| `/session/wechat` | POST | `session/me` | 旧 `code` 被忽略，保留兼容映射 |
| `/membership/applications` | POST | `membership/apply` | `displayName`、`inviteCode`、`rulesVersion` |
| `/membership/applications/mine` | GET | `membership/mine` | — |
| `/me/profile` | GET | `me/profile` | — |
| `/me/exports` | POST | `me/exports` | — |
| `/me/account` | DELETE | `me/account/delete` | `confirm` |
| `/posts` | GET | `posts/list` | `cursor`、`type`、`topicId`、`filter` |
| `/posts` | POST | `posts/create` | 内容字段 + `idempotencyKey` |
| `/posts/:id` | GET | `posts/detail` | `id` |
| `/posts/:id` | DELETE | `posts/delete` | `id`、`expectedVersion` |
| `/posts/:id/visibility` | PATCH | `posts/visibility` | `id`、`visibility`、`expectedVersion` |
| `/posts/:id/reaction` | PUT/DELETE | `posts/reaction` | `id`、`next` |
| `/posts/:id/bookmark` | PUT/DELETE | `posts/bookmark` | `id`、`next` |
| `/posts/:id/comments` | GET | `posts/comments/list` | `id`、`cursor` |
| `/posts/:id/comments` | POST | `posts/comments/create` | `id`、评论字段 + `idempotencyKey` |
| `/me/contents` | GET | `me/contents` | `tab`、`cursor` |
| `/me/contents?tab=topics` | GET | `me/topics` | `cursor` |
| `/reports` | POST | `reports/create` | 举报字段 |
| `/topics` | GET/POST | `topics/list`/`topics/create` | query 或话题字段 |
| `/topics/:id` | GET | `topics/detail` | `id`、`cursor` |
| `/topics/:id/follow` | PUT/DELETE | `topics/follow` | `id`、`next` |
| `/me/topics` | GET | `me/topics` | `cursor` |
| `/collections` | GET | `collections/list` | — |
| `/collections/:id` | GET | `collections/detail` | `id` |
| `/collections/:id/submissions` | POST | `collections/submit` | `id`、`postId`、`consentVersion` |
| `/consents/:postId` | DELETE | `consents/revoke` | `postId` |
| `/notifications` | GET | `notifications/list` | `tab`、`cursor` |
| `/notifications/read-all` | POST | `notifications/read-all` | — |
| `/notifications/unread-count` | GET | `notifications/unread-count` | — |
| `/search` | GET | `search/query` | `q`、`scope`、`cursor` |
| `/search/suggestions` | GET | `search/suggestions` | — |
| `/search/private` | GET | `search/private` | `q` |
| `/assets/upload-intents` | POST | `assets/intent` | `mediaType=image`、压缩后 `size`、`mimeType` + intent 幂等键 |
| `/assets/upload` | POST | `assets/upload` | `assetId`、`contentBase64` + upload 幂等键；服务端清洗并绑定 fileId |
| `/assets/confirm` | POST | `assets/confirm` | `assetId` + confirm 幂等键；不传 `fileId` |
| `/assets/:id` | GET | `assets/status` | `assetId` |
| `/admin/queues/:queue` | GET | `admin/queue` | `queue`、`cursor` |
| `/admin/reviews/:id/decision` | POST | `admin/content/decide` | `id` + 决策字段 |
| `/admin/members/applications/:id` | POST | `admin/membership/decide` | `id` + 决策字段 |

后端返回 `{ code, message, data, requestId }`。成功时 request 只 resolve `data`；`code` 为错误 kind 时统一转换为 `ApiError`，沿用前端 `network`、`timeout`、`server` 等 UI 分类。

## 弱网与幂等

`request(url, { idempotencyKey })` 会把键合并进 `payload.idempotencyKey`。`POST /posts` 和 `POST /posts/:id/comments` 的键由草稿或调用方生成并持久化；图片 intent、upload、confirm 也各自保存稳定键。请求超时、网络中断后使用原键再次调用，后端 `claimIdempotency` 会返回首次结果。键不再放进 HTTP header，也不依赖 Bearer 会话。

图片选择后先由 `wx.compressImage` 压缩，再由文件系统读取 base64 并检查实际 JPEG/PNG 头与 2MiB 解码大小。上传服务逐个轮询 `assets/status`，只有 `verified` 的 `assetId` 才进入 `posts/create`；审核超时、网络失败或用户取消都会保留附件状态和草稿，重试不会重新上传已经 verified 的图片。`capabilities.uploads` 为 false 时页面入口保持关闭。

## 验证

在前端工作树运行：

```bash
node tests/transport.test.mjs
node tests/uploads.test.mjs
node scripts/check.mjs
npm run lint
```

这些检查覆盖 action/payload 映射、旧登录兼容边界、幂等键保持和请求层不生成 Bearer。真实数据库适配与云函数部署属于后端/联调范围，本任务不部署、不推送。
