# 会员页面联调说明

本文件记录 T-11（加入文学社、社团名片）与 T-12b（社区约定）的前端接入边界。页面只使用
`services/membership.js` 的用例，不在前端保存或判断邀请码，也不把成员资格写成本地永久状态。

## 页面与入口

| 页面 | 路径 | 入口 | 说明 |
| --- | --- | --- | --- |
| 加入文学社 | `/pages/community/join/index?from=<origin>` | 我的、话题空态、社团名片 | `from` 只用于服务端确认入社后的返回位置，表单输入保留在当前页面栈 |
| 社团名片 | `/pages/community/club/index` | 我的、加入页 | 访客只看公开介绍、约定入口和成员资格状态 |
| 社区约定 | `/pages/community/rules/index?from=<origin>` | 加入页、社团名片、设置、通知 | 返回使用原页面栈，不把昵称或邀请码放进 URL |

三个页面已经加入 `community` 分包，`utils/navigate.js` 不再把它们标记为待实现。项目配置的
AppID 是 `wx39773ed34aa30776`。

## 会话与接口

`services/membership.js` 通过现有 `api/request.js` 调用接口路径；CloudBase transport 负责把路径映射到
后端 `api` 云函数的 action，页面不直接调用 `wx.cloud.callFunction`。

| 前端路径 | CloudBase action | 用途 |
| --- | --- | --- |
| `GET /session/me` | `session/me` | 获取当前会话、成员状态、能力开关和公开社团资料 |
| `GET /membership/applications/mine` | `membership/mine` | 读取当前申请状态与处理理由 |
| `POST /membership/applications` | `membership/apply` | 提交 `displayName`、`inviteCode`、`rulesVersion` |

后端从 CloudBase 会话取得身份。页面不会索取手机号、位置、学号、通讯录，也不会把邀请码写入
storage、埋点或 URL。提交后必须刷新 `/session/me` 并同步 `app.globalData.session` 与
`session-changed`；只有服务端会话返回 `memberStatus: active` 才显示已入社。提交响应丢失或会话刷新失败时显示待确认与只读重试，不称申请失败，也不自动重复提交邀请码。

## 申请状态

加入页覆盖六种用户可感知的状态：

| 页面状态 | 触发来源 | 页面行为 |
| --- | --- | --- |
| `idle` | 尚未申请或会话尚未完成 | 显示表单 |
| `invalid_code` | 后端 `invalid_input`（含无效、过期、用尽邀请码） | 统一显示“邀请码无效或已过期”，保留输入 |
| `duplicate` | 后端 `conflict` 或返回 `duplicate` | 不重复创建，提供刷新和联系管理员 |
| `pending` | 后端返回 `state: pending`，或会话返回待确认 | 保留历史待处理申请与成员资格被移除后的恢复申请；可展开表单再次验证邀请码，最终状态仍由服务端决定；提供刷新/联系管理员，不自动重复提交 |
| `active` | 仅 `session/me.memberStatus: active` | 显示已加入，可回到 `from` 指定的 Tab；新用户凭有效邀请码验证通过后直接生效 |
| `rejected` | 后端返回 `rejected` 或 `removed` | 显示理由（如果服务端提供），提供联系管理员与重新提交入口 |

后端对邀请码不存在、过期和用尽使用同一错误文案，前端不尝试区分这些原因，以免形成邀请码枚举入口。

## 约定页内容

约定页从 `session/me.club.rulesVersion` 读取版本号；当前 Mock 为 `v1.1`。正文将以下三层分开：

1. 社团约定：原有“不涉黄、不涉政、不人身攻击”，并补充不骚扰、不披露他人隐私、尊重作品来源、举报与申诉、匿名边界、公开范围解释。
2. 平台要求：遵守小程序平台规范与内容审核要求，不利用功能传播垃圾、诈骗或侵权内容。
3. 法律义务：不发布法律禁止内容，不侵害名誉、隐私、著作权等合法权益，依法配合必要处理。

阅读约定再返回加入页时，输入只存在于加入页实例中，不通过 URL 或跨账号 storage 传递，因此会保留且不扩大数据采集范围。

设置页的数据权利入口也已接入同一 transport：导出调用 `POST /me/exports`（action `me/exports`），注销调用
`DELETE /me/account`（action `me/account/delete`，确认串为“注销”）。只有收到 `queued` 或 `pending` 才更新为已提交/处理中；网络失败、未知返回和服务端错误都回显“待处理”，不会把失败显示成完成。

## 联调验收

- Mock：确认 `session/me` 返回 `club` 后，社团名片与约定页能显示资料、版本和空公告态。
- CloudBase：确认 `api` 云函数对 `session/me`、`membership/mine`、`membership/apply` 返回统一 `{ code, message, data }` 包装。
- 使用无效/过期邀请码时，页面显示统一文案；不在日志、storage 或 URL 中出现邀请码。
- 模拟 active、pending、rejected 与重复申请响应；提交成功后需会话刷新为 active 才显示已加入。
- 模拟提交请求超时但服务端已完成的情况，确认页面重读 `/session/me` 后识别 active，不误报失败或重复消耗邀请码。
- 网络错误时页面显示可重试态；已有的社团资料不会被清空。
- 只完成了代码、静态结构和 lint 验证；尚未在微信开发者工具或真机上验收，也没有部署或推送。
