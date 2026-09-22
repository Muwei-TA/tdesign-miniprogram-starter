# 内容互动与发布联调说明

本次实现覆盖 T-06 评论与互动、T-09 我的内容六 tab，以及 P04 文字发布的可靠性边界。页面仍通过现有
HTTP 风格 service 调用，CloudBase transport 负责映射 action；本任务没有修改 `api/*`、`app.json`、
`utils/navigate.js` 或 `project.config.json`。

## 接口与页面

| 前端调用 | CloudBase action | 页面用途 |
| --- | --- | --- |
| `GET /posts/{id}/comments` | `posts/comments/list` | 读取已通过审核的一级评论和一级回复 |
| `POST /posts/{id}/comments` | `posts/comments/create` | 提交 `body`、`replyToId`、`identityMode`、幂等键 |
| `PUT/DELETE /posts/{id}/reaction` | `posts/reaction` | 共鸣开关，页面乐观更新、失败回滚 |
| `PUT/DELETE /posts/{id}/bookmark` | `posts/bookmark` | 收藏开关，页面乐观更新、失败回滚 |
| `GET /me/contents?tab=...` | `me/contents` 或 `me/topics` | 已发布、待审、私密、收藏、关注话题 |
| 本地账号作用域草稿 | — | 草稿 tab；不伪造不存在的编辑/重提后端 |

评论组件只渲染传入 DTO 和本地 pending 占位，不自行请求或判断权限。页面按服务端
`post.viewer.canComment` 与 `commentsEnabled` 决定是否开放输入；`private` 内容不渲染评论区和互动入口。
评论只允许一级评论和定向回复，组件不会继续嵌套回复。

## 匿名与待审核边界

- 服务端返回的匿名评论只展示 `alias`，不渲染 `userId`、真实昵称或主页入口。
- 匿名帖作者在本帖回复时使用树洞身份，并保留“作者”标签；本地 pending 占位也只显示“树洞身份”。
- 提交评论后立即插入“等待审核”占位；服务端只返回 `state: pending` 才显示已收到。
- 评论请求失败会保留输入和同一个幂等键，用户重试不会重复创建；正文改变后才生成新键。
- 评论加载失败保留已加载评论，并显示“回应未更新”和重试入口。

## 我的内容

`pages/community/my-content` 使用一个页面和一个请求流程切换六个 tab：

`published`、`pending`、`draft`、`private`、`bookmark`、`topics`。

待审核/退回条目只显示服务端状态和理由，不提供虚假的“重新提交”或“重新编辑”按钮，因为当前后端
没有内容编辑接口。草稿只来自 `services/drafts.js`，恢复走 P04；失效收藏只显示中性占位，移除动作
调用收藏删除接口，不保留摘要或正文。

主 Agent 集成时需在 `app.json` 的 `pages/community` 分包追加 `my-content/index`，并从
`utils/navigate.js` 的待实现清单移除 `/pages/community/my-content/index`。这些共享注册文件按任务要求留给主 Agent。

## 文字发布可靠性

发布页等待 `session-changed` 或已有 `app.globalData.session` 后再判断 `memberStatus`，不会在冷启动会话尚未
恢复时误把成员送走。服务端能力开关采用 fail-closed：

- `capabilities.publishing !== true` 时不显示编辑器提交入口，只提供回树洞/申请成员资格的状态。
- `capabilities.uploads !== true` 时图片入口置灰并说明未开放；草稿中已有图片不能提交，纯文字仍可保存草稿。
- `capabilities.video` 继续控制视频入口，当前仍关闭。

草稿保存会对可提交内容生成本地指纹。同一内容沿用同一个 `idempotencyKey`，正文、范围、身份、话题、文集
授权或媒体发生变化时生成新键。网络超时后再次提交会复用旧键；防双击由页面和评论组件的 submitting 状态共同阻断。

## 验证边界

- 已添加 `tests/content-integration.test.mjs`，验证真实草稿 service 的同内容重试稳定、内容变更换键，以及发布能力/上传能力门控。
- 已完成定向 ESLint、Node 语法、JSON 与静态路由检查；全库基线问题需单独处理。
- 未做微信开发者工具真机/模拟器最终验收，未部署，未推送。
