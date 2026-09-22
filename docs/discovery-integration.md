# Discovery 页面集成清单

本分支实现 T-07、T-08、T-14b 与 T-02b，基点为 `codex/cloudbase-integration`。页面读取服务端 DTO，未部署、未推送，也未在本分支修改 `app.json`、`utils/navigate.js` 或 `api/*`。

## 路由注册

主 Agent 集成时把下面三个页面加入 `pages/community` 分包，并从 `utils/navigate.js` 的 `PENDING_PAGES` 删除对应项：

| 页面 | 参数 | 来源 |
|---|---|---|
| `pages/community/topic/index` | `id` | 话题列表、首页周话题、搜索、发布内容的话题标签 |
| `pages/community/collection/index` | `id` | 文集目录 |
| `pages/community/profile/index` | `userId` | 署名作者的 `author.userId` |

话题详情进入发布器时只传 `topicId`，不在 URL 预选身份或可见范围；文集详情只传 `mode=article&collectionId`，发布页仍要求作者明确勾选授权。

## DTO 与能力边界

- `topics/detail` 使用 `{ topic, canPost, items, nextCursor }`；`topic.status=archived` 仍可读，但不允许新写入。
- `collections/detail` 使用 `{ collection, entries, canSubmit }`。前端在 `capabilities.anthology !== true` 时直接显示“文集暂未开放”，不请求目录或详情；不根据空数组伪造内容。
- `profile/get` 使用 `{ user, memberStatusText, visibleCount, items, nextCursor }`，只展示服务端返回的署名作品。前端不实现虚假翻页，匿名与私密内容不进入主页。
- `me/profile/update` 接收 `{ displayName }`；资料页保存后重新 `bootstrapSession()` 并广播 `session-changed`。头像上传只显示未开放说明，不调用媒体选择器。

现有 `api/endpoints.js` 未登记 profile 两个路径；若主 Agent 要统一路径常量，可补充 `/profile/:targetUserId` 与 `/me/profile`，同时保持 `api/transport.js` 已有的 `profile/get` 和 `me/profile/update` 映射。当前 `services/profiles.js` 使用同样的契约路径，未改公共 API 文件。

## 验证

`tests/discovery-pages.test.mjs` 检查能力开关、授权入口、话题发布参数、实名主页隐私边界、资料保存流程和通用组件状态；`scripts/check.mjs` 负责 JS/JSON/WXML 结构与组件注册检查。
