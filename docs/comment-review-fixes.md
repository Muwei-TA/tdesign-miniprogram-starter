# 评论审查修复与接口补充（2026-09-24）

本文件补充 `04-data-model-and-api.md`，与后端 `docs/comment-review-fixes.md` 对应。仅修复本次分支合并审查 F1–F6，不表示已部署或完成微信真机验收。

## 接口增补

### `posts/comments/create`

原有请求、幂等键不变。成功响应保留 `id`、`state`，新增：

```js
{ id, state, version, comment: CommentDTO }
```

`version` 和 `comment.version` 为前台审核完成后重新读取的当前版本，不是创建时固定版本 1。`comment` 必须经白名单 presenter 构建，匿名身份不返回真实用户 ID。客户端以该 DTO 替换临时占位；`pending` 和 `published` 可按服务端 `viewer.canDelete` 删除，`rejected`/`deleted` 不继续展示原文。兼容旧响应：缺少有效 DTO 时重新请求评论，不开放临时占位的删除权限。

提交结果尚未确认（包括请求超时但服务端可能已提交）时，临时占位不可本地“删除成功”。重试相同内容复用原幂等键，确认真实 ID 后才能调用删除接口。

### `posts/comments/list`

请求 `{ id, cursor?, pageSize? }`；响应仍为 `{ items: CommentDTO[], nextCursor }`。分页按实际可见的评论/回复 `(createdAt, _id)` 升序遍历；仅已发布或当前作者自己的待审记录参与分页。无可见回复的删除记录不占分页额度。

回复的父级不在当前页时，响应补取同帖可见父级；已删除父级仅输出无作者、无原文的墓碑。父级可跨页重复出现；客户端必须按根评论 ID 合并，并按回复 ID 去重，不能直接拼接根数组。`nextCursor` 来源是当前页实际遍历的最后一条可见记录，不是补取父级。页面触底加载下一页。

### `posts/reaction` / `posts/comments/reaction`

请求和 action 名称不变。响应为 `{ ok: true, reacted: boolean, count: number }`，`count` 是事务完成时的目标计数。帖子级共鸣查询排除带 `commentId` 的记录；收藏语义不变。关系增删与计数更新由同一 PostgreSQL RPC `hg_toggle_reaction` 提交，不允许失败后退回非原子写入。

## 修复映射

| 编号 | 修复 |
|---|---|
| F1 | 提交成功关联真实 ID/当前版本；未确认的临时占位禁止假删除 |
| F2 | 帖子共鸣标记排除评论级记录，避免标记污染和读取额度挤占 |
| F3 | 重复/并发增删以实际受影响行数更新计数，关系与计数同事务 |
| F4 | 搜索游标绑定关键词和范围；新查询首页完成前禁止追加 |
| F5 | 可见评论游标分页，跨页补取父级；前端按 ID 合并父子节点 |
| F6 | 共鸣回滚重新按 ID 定位；新的服务端快照不被旧响应覆盖 |

## 验证与发布边界

前端 CI 执行 `npm ci`、`npm test`、`npm run check`；后端 CI 另执行共享代码同步，以及隔离 PostgreSQL 测试数据库的并发、故障回滚和权限用例。CI 不部署云函数、不读取生产数据。通过记录见各 PR 的 GitHub Actions。

上线顺序：先确认现有迁移及新增 `20260925130000_atomic_reaction_toggle.sql` 已应用，再部署匹配版本的后端 API/Worker，最后发布前端。新增迁移尚未在用户云环境执行，缺少 RPC 时新共鸣接口会报错，不能先部署 API。发布前仍须进行微信开发者工具/双账号真机验收，尤其是审核后立即删除、超时重试、匿名评论及分页回复。
