> 2026-09-23 续作更新：downloadFile 域名、OPA 签名读取及微信 IDE 后台审核已完成真实开发环境复验；以下历史阻塞以 `evidence/continuation-20260923.json` 为最新结果。真机与完整多角色验收仍待执行。

# CloudBase 真实验收记录

更新：2026-09-23。环境为 `shudong-d4g4blap4a5069a28`（上海），小程序 AppID 为 `wx39773ed34aa30776`。本文记录开发环境证据，不代表真机、微信审核或正式发布完成。

## 已取得的证据

| 验收项 | 结果 |
|---|---|
| 真实微信文字安全 | API 真实调用通过；最新 `admin/security/check` 返回 `pass` |
| 文字内容 | `df912774-fe9c-4e31-b74d-412d02db3ff1` 为 `published`、v2 |
| 原生 UI 回应 | `b8ba47e4-22b2-4a58-95ee-7d495f52685a` 已由数据库证实为 `published`，回应计数为 1；页面证据见 [published-comment.jpg](evidence/published-comment.jpg) |
| 私密内容隔离 | `0c0f9e22-7a04-41f8-87fe-ce89a83ec428` 真实微信创建为 `private_saved`；管理调用伪造 owner 读取仍返回 `not_accessible` |
| PG 图片链路 | 资产 `bd740f16-d05e-447f-8704-72bef2d5bf8d` 为 `verified`，清洗 JPEG 为 48×48、675 字节 |
| 图文发布 | `d93b0b67-5893-4202-879f-de9e5773a867` 为 `published`、v2；匿名作者响应的 `userId` 与 `displayName` 均为 `null` |
| PostgreSQL | 12 项迁移已应用到远端 |
| 自动检查 | 后端 111 项测试与 lint/check、前端 8 项测试与 lint/check 均通过；当前 22 个页面 pending 为 0 |

## 审核与恢复边界

前台本人审核已复用租约/RPC 并完成验证。单独 SCF timer 仍返回 `-501001`，后台重试失败保持待审，达到上限转人工；不能把后台失败写成自动审核通过。

## 尚未验收

- `wx.getImageInfo` 被 `downloadFile` 合法域名拦截。已请求加入 `https://shudong-d4g4blap4a5069a28.api.tcloudbasegateway.com`，等待确认后复验图片预览。
- 真机输入、图片展示、回应、返回栈及正式上传/发布尚未执行。
- 开发预览码已生成，包总大小 1,371,384 bytes、主包 1,166,399 bytes；`preview-20260923.jpg` 仅作开发预览，未作为正式上传或发布证据。

公开、视频、文集、导出能力继续关闭。下一步先完成图片域名白名单回执与 `wx.getImageInfo` 复验，再进行真机验收；timer token/权限问题单独排障。
