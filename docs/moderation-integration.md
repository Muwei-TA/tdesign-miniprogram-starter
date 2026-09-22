# T-13 管理台联调说明

P15 管理台位于 `/pages/admin/index`，本次实现包含页面与 `moderation-item` 组件，但没有修改 `app.json`、`project.config.json` 或 `utils/navigate.js`。主 Agent 集成时需要把它加入 `pages/admin` 分包，并移除导航封装中的 P15 待实现提示。

## 五个队列

| 队列 | 读取 action | 决定 action | 允许的决定 | 理由要求 |
|---|---|---|---|---|
| 内容 | `admin/queue` | `admin/content/decide` | `approve` / `reject` / `hide` | `reject`、`hide` 必填；内容决定带 `expectedVersion` |
| 话题 | `admin/queue` | `admin/topic/decide` | `approve` / `archive` / `reject` | `archive`、`reject` 必填 |
| 入社 | `admin/queue` | `admin/membership/decide` | `approve` / `reject` | `reject` 必填 |
| 举报 | `admin/queue` | `admin/report/decide` | `keep` / `hide` / `escalate` | 全部必填 |
| 文集 | `admin/queue` | `admin/collection/decide` | `include` / `skip` | `skip` 必填 |

`services/moderation.js` 继续暴露 HTTP 风格 service 调用；T-17 的 `api/transport.js` 将它们转换为上述 action。页面不会直接调用 `wx.cloud.callFunction`。

## DTO 与隐私边界

后端队列 DTO 的公共字段为 `id`、`queue`、`title`、`summary`、`submittedAtText`、`statusText`，内容队列额外使用 `assetIds`、`visibility`、`isAnonymous`，举报队列使用 `targetType/targetId`，文集队列使用 `postId/collectionId`。

前端 service 在 `normalizeQueueItem` 中白名单过滤字段。`ownerId`、`reporterId`、`mappings`、匿名 alias/真实身份和私密正文不会传入组件；匿名内容只显示“树洞身份”标签。普通成员进入深链时显示无权页面，接口仍由后端 `policies.canAccessModeration` 做最终鉴权。

内容审核操作只使用 `expectedVersion` 做并发版本锁，不提供修改作者可见范围的按钮。媒体区只展示后端返回的附件数量；实际媒体审片需要后端提供授权查看链路，本任务不拼接对象存储 URL。

## 验证

```bash
node tests/moderation.test.mjs
npx eslint pages/admin/index.js components/moderation-item/index.js services/moderation.js --no-eslintrc -c ./.eslintrc.js
node scripts/check.mjs
```

本次未部署、未推送，也未在微信开发者工具/真实 CloudBase 数据库上执行管理台端到端验收。联调时应分别验证管理员、普通成员和权限被撤销三种会话，确认队列读取与处理决定都由后端返回结果驱动。
