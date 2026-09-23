# 04｜数据模型与接口契约

> 以 HTTP 风格表达；若最终采用云函数，保留同样的用例边界与字段。**本章是前后端唯一契约来源。**

## 4.1 实体（关键字段，非完整 DDL）

| 实体 | 字段 | 约束 |
|---|---|---|
| `User` | `id`、`wxOpenIdRef`、`displayName`、`avatar`、`status` | 微信标识不入公开资料；昵称自选 |
| `Membership` | `userId`、`clubId`、`role`、`status`、`joinedAt` | `userId+clubId` 唯一；撤销即时影响鉴权 |
| `Post` | `id`、`clubId`、`ownerId`、`kind`、`title`、`body`、`visibility`、`identityMode`、`status`、`version`、`topicId`、`assetIds`、`commentsEnabled`、`createdAt` | `ownerId` 由会话决定；匿名帖响应不带 `ownerId` |
| `AnonymousIdentity` | `threadId`、`userId`、`alias` | 受限存储；线程内稳定，跨帖不可串联 |
| `Asset` | `id`、`ownerId`、`storageKey`、`mediaType`、`size`、`duration`、`status`、`postVersion` | 私有桶；只能绑定本人已校验附件 |
| `Comment` | `id`、`postId`、`ownerId`、`replyToId`、`body`、`identityMode`、`status`、`version` | 继承帖子访问边界；`replyTo` 必须同帖 |
| `Reaction` / `Bookmark` | `userId`、`postId`、`type` | 唯一键防重；收藏不赋予永久读取权 |
| `Topic` | `id`、`clubId`、`title`、`description`、`category`、`status` | 首版均为社内；`pending/active/archived` |
| `Collection` / `Entry` | `id`、`title`、`visibility`、`editorId`；`postId`、`consentId`、`order` | 不做正文快照；访问取交集 |
| `Consent` | `postId`、`version`、`purpose`、`scope`、`grantedAt`、`revokedAt` | 与用途/版本绑定 |
| `Notification` | `recipientId`、`eventType`、`targetId`、`readAt` | 中性文案；渲染时复核权限 |
| `Report` / `AuditLog` | `target`、`reason`、`status`；`actor`、`action`、`time`、`decision` | 受限读取；日志不存原私密正文 |
| `Draft` | `id`、`ownerId`、`payload`、`idempotencyKey`、`updatedAt` | 首版存本地，账号作用域 |

### 枚举

```text
kind:          fragment | article | event
visibility:    public | club | private
identityMode:  named | anonymous
postStatus:    draft | uploading | pending | published | rejected | hidden | deleted | superseded
topicStatus:   pending | active | archived
role:          guest | member | admin | moderator
memberStatus:  none | pending | active | rejected | removed
notifyType:    comment | reply | reaction_digest | system_review | system_report
                | system_collection | system_membership | system_notice
```

## 4.2 响应包装

```json
{ "code": 0, "message": "ok", "data": { }, "traceId": "..." }
```

- HTTP 200 + `code = 0` 视为成功；其余按 `04.6` 错误码映射。
- 列表统一：`{ "items": [], "nextCursor": null }`；`nextCursor` 为 `null` 表示无更多。

## 4.3 展示 DTO（前端渲染唯一依据）

### PostCardDTO（列表用）

```json
{
  "id": "p1",
  "kind": "fragment",
  "category": "生活",
  "title": "",
  "excerpt": "今天的晚霞，像一封没写完的信……",
  "createdAtText": "今天 18:20",
  "visibility": "club",
  "identityMode": "named",
  "author": { "userId": "u_a", "displayName": "南枝", "avatar": "", "isAnonymous": false, "alias": null },
  "topic": { "id": "t1", "title": "把今天的晚霞留在这里" },
  "media": { "type": "image", "images": ["..."], "count": 2, "video": null },
  "counters": { "reactions": 12, "comments": 3 },
  "viewer": { "reacted": false, "bookmarked": false, "canComment": true, "isOwner": false, "canManage": false },
  "status": "published",
  "statusText": null
}
```

**约束**

1. `author.userId` 仅在 `isAnonymous = false` 时返回；匿名帖返回 `alias`，`userId` 必须为 `null`。
2. `viewer.*` 由服务端按当前会话计算，前端**不得**自行推断（例如不得用 `ownerId === myId`）。
3. 不可访问内容不出现在列表中，也不出现在 `counters` 统计中。
4. `statusText` 仅在本人可见的 `pending/rejected` 场景下返回（如"等待审核"/"需要修改：原因…"）。

### PostDetailDTO（详情用）

在 `PostCardDTO` 基础上增加：

```json
{
  "body": "完整正文（保留换行）",
  "paragraphs": ["段1", "段2"],
  "media": { "type": "video", "video": { "url": "", "cover": "", "duration": 4, "ready": true } },
  "commentsEnabled": true,
  "version": 3,
  "consent": { "collectionGranted": false },
  "viewer": { "canShrinkVisibility": true, "canDelete": true, "canReport": true }
}
```

- 长文 `paragraphs` 由服务端按空行切分，前端只渲染，不做富文本解析（首版无 HTML）。
- 视频 `ready = false` 时前端显示"正在处理，完成后才会展示"，不给播放按钮。

## 4.4 接口清单

| # | 接口 | 方法 | 入参要点 | 返回/规则 |
|---|---|---|---|---|
| A1 | `/session/wechat` | POST | 微信登录 code | `{ sessionToken, role, memberStatus, user, capabilities }` |
| A2 | `/session/me` | GET | — | 同上（用于冷启动恢复） |
| A3 | `/membership/applications` | POST | `inviteCode`、`displayName`、`rulesVersion` | `pending`；邀请码服务端校验、限频 |
| A4 | `/membership/applications/mine` | GET | — | 当前申请状态与理由 |
| B1 | `/posts` | GET | `cursor`、`type`、`topicId`、`filter=awaiting_reply` | `PostCardDTO` 列表；仅返回允许展示 |
| B2 | `/posts/{id}` | GET | — | `PostDetailDTO`；无权统一 `not_accessible` |
| B3 | `/posts` | POST | 正文、`assetIds`、`visibility`、`identityMode`、`topicId`、`commentsEnabled`、`Idempotency-Key` | `{ id, version, state }`，`state ∈ pending/private_saved` |
| B3a | `/posts/{id}/resubmit` | PATCH | `title`、`body`、`expectedVersion`、`Idempotency-Key` | 仅有效成员本人对 `rejected` 原帖重提；保留原附件/身份/可见范围，原子增加版本并新建审核任务；返回 `{ id, version, state }` |
| B4 | `/posts/{id}/visibility` | PATCH | `visibility`、`expectedVersion` | 首版只允许缩小；同步失效权限版本 |
| B5 | `/posts/{id}` | DELETE | `expectedVersion` | 停止展示 + 媒体权限回收 + 异步清理 |
| B6 | `/posts/{id}/reaction` | PUT/DELETE | — | 幂等；删除/隐藏后不可新增 |
| B7 | `/posts/{id}/bookmark` | PUT/DELETE | — | 幂等 |
| B8 | `/posts/{id}/comments` | GET | `cursor` | 一级评论 + `replies` |
| B9 | `/posts/{id}/comments` | POST | `body`、`replyToId`、`identityMode`、`Idempotency-Key` | `pending`，审核通过后展示 |
| C1 | `/topics` | GET | `category`、`cursor` | 话题卡；访客不返回社内计数与摘要 |
| C2 | `/topics/{id}` | GET | — | 详情 + 是否关注 |
| C3 | `/topics` | POST | `title`、`description`、`category` | `pending`；同名引导参与 |
| C4 | `/topics/{id}/follow` | PUT/DELETE | — | 关注仅保存到"我的话题" |
| D1 | `/collections` | GET | — | 文集列表（含 `visibility`） |
| D2 | `/collections/{id}` | GET | — | 导语 + 目录（实时读取文章状态） |
| D3 | `/collections/{id}/submissions` | POST | `postId`、`consentVersion` | 申请，不自动收录、不扩范围 |
| D4 | `/consents/{postId}` | DELETE | — | 撤回授权，目录同步移除 |
| E1 | `/notifications` | GET | `tab=reply/system`、`cursor` | 中性文案；渲染前复核 target |
| E2 | `/notifications/read-all` | POST | — | 仅更新本人状态 |
| E3 | `/notifications/unread-count` | GET | — | 用于 P01 红点 |
| F1 | `/search` | GET | `q`、`scope=post/topic`、`cursor` | 先鉴权后排序；空结果给建议 |
| F2 | `/search/suggestions` | GET | — | 编辑维护的无敏感推荐词 |
| G1 | `/assets/upload-intents` | POST | `mediaType`、`size`、`duration`、`mimeType` | 限时上传授权；实际文件仍二次校验 |
| G2 | `/assets/{id}` | GET | — | 处理状态（图片/视频审核与转码） |
| H1 | `/reports` | POST | `targetType`、`targetId`、`reason`、`evidence?` | 回执；不暴露举报人 |
| I1 | `/admin/queues/{queue}` | GET | `cursor` | 五队列；后端角色鉴权 |
| I2 | `/admin/reviews/{id}/decision` | POST | `decision`、`reason`、`expectedVersion` | 事务 + 审计 + 通知 |
| I3 | `/admin/members/applications/{id}` | POST | `decision`、`reason` | 批准/拒绝 |
| J1 | `/me/exports` | POST | — | 异步任务；需二次确认身份 |
| J2 | `/me/account` | DELETE | 确认串 | 风险告知 → 清理/依法保留 → 结果通知 |
| J3 | `/me/contents` | GET | `tab`、`cursor` | 发布/待审/私密/收藏/关注话题 |

## 4.5 游标分页与一致性

- 游标为服务端不透明串，包含 `createdAt + id`，保证新帖插入不产生重复。
- 前端下拉刷新重置游标；上拉加载携带 `nextCursor`。
- 详情页操作后通过 `post-changed` 让列表局部更新，不整列表重拉。

## 4.6 错误码映射

| `kind` | HTTP | 前端行为 |
|---|---|---|
| `unauthenticated` | 401 | 清账号缓存 → 访客态 → 关键动作时引导授权 |
| `membership_invalid` | 403 | 提示"社内内容需要成员资格" → 引导 P12 |
| `forbidden` | 403 | 提示无权执行该操作，不解释内部原因 |
| `not_accessible` | 404 | 统一"内容当前不可访问"，**不显示标题** |
| `invalid_input` | 422 | 定位到具体字段并提示（字数/数量/格式） |
| `conflict` | 409 | 版本冲突：提示已被更新，提供刷新 |
| `pending_media` | 409 | 提示附件仍在处理，禁止提交 |
| `rate_limited` | 429 | 提示稍后再试，按 `Retry-After` 退避 |
| `network` / `timeout` | — | 保留已加载数据 + "未更新" + 重试按钮 |
| `server` | 5xx | 统一故障提示 + 重试；写操作先查状态再重试 |

**关键规则**：`not_accessible` 与"内容不存在"必须返回同一形态，防止探测私密 ID 是否存在。

## 4.7 发布事务（前端时序）

```text
1. 编辑器本地存草稿（含 idempotencyKey）
2. 若有媒体：POST /assets/upload-intents → 逐个上传 → 轮询 G2 至 status=verified
3. POST /posts（带 Idempotency-Key + assetIds）
4. 成功 → 清草稿 → redirectTo community/result?state=pending|private_saved
5. 超时/网络未知 → 不重复提交；用同一 idempotencyKey 重试或查询状态
```

失败分级提示：单附件失败 → 可单独重试；正文提交失败 → 保留草稿并给"重试提交"。


## 4.8 用量护栏（2026-09-23 已联调）

`GET /admin/usage/status` 由传输层映射为 `admin/usage/status`，payload 为空。后端依据当前微信成员身份核验 active moderator/admin，并从上下文取 clubId；客户端传入角色或 clubId 不授予权限。

返回 `date`、`timezone: "UTC"`、`updatedAt`，以及：

- `upload`: `usedBytes`、`reservedBytes`、`dailyLimitBytes`、`userDailyLimitBytes`、`remainingBytes`、`warningRatio`、`alertState`、`alertedAt`。个人限额为滚动 24 小时，社团为 UTC 日窗。
- `review`: `calls`、`textCalls`、`imageCalls`、`dailyLimitCalls`、`remainingCalls`、`warningRatio`、`alertState`、`alertedAt`。

`alertState` 为 `ok / near_limit / limit_reached / disabled`。缺字段或类型无效显示读取失败，不伪装为零用量；身份失效立即清空管理快照。上传超限返回 `rate_limited`，读取不受上传限额影响。审核额度不足保留 queued 至下一 UTC 窗口，不消耗失败次数。

已发布图片预览每次重新请求 `posts/detail`；管理附件经 `assets/status` 重新授权。失败不会回落缓存签名链接；原生选图页面的本地预览保持不变。
