# 09｜模板改造清单（文件级）

> 基线：TDesign 小程序通用模板（`Muwei-TA/tdesign-miniprogram-starter`）。
> 原则：保留原生 JS/WXML/LESS + TDesign，不迁移 Taro/React/TS，不新增依赖。

## 9.1 页面映射

| 产品页 | 模板路径 | 动作 |
|---|---|---|
| P01 树洞 | `pages/home/index` | **改造**：信息流、范围标识、本周话题、发帖入口 |
| P02 话题 | `pages/topics/index` | **新增**主 Tab |
| P06 文集 | `pages/anthology/index` | **新增**主 Tab |
| P09 我的 | `pages/my/index` | **改造**：去掉"推荐服务"，改为内容管理 |
| P08 消息 | `pages/message/index` | **改造**：从聊天列表改为通知中心，移出主 Tab |
| P04 发布 | `pages/release/index` | **重做**：状态机、媒体、草稿、范围与身份 |
| P11 搜索 | `pages/search/index` | **改造**：接权限内搜索 |
| P12 加入 | `pages/community/join/index` | **新增**（替代 `pages/login`） |
| P13 设置 | `pages/setting/index` | **改造**：隐私、缓存、导出、注销 |
| P03/P05/P07 | `pages/community/{topic,post,collection}` | **新增**（community 分包） |
| P10/P14/P16/P17/P18 | `pages/community/{my-content,club,rules,result,profile}` | **新增** |
| P15 管理 | `pages/admin/index` | **新增**独立分包 |
| — | `pages/chat`、`pages/loginCode`、`pages/dataCenter`、`pages/login` | **移除** |

## 9.2 文件级改造表

| 文件 | 当前状态 | 目标动作 | 状态 |
|---|---|---|---|
| `app.json` | 3 主 Tab、含 chat/loginCode/dataCenter 分包 | 四主 Tab、community/admin 分包、移除废弃分包 | ✅ 已改 |
| `app.js` | `import { connectSocket, fetchUnreadNum } from './mock/chat'` | **移除聊天 socket**，改为站内通知未读数 | ✅ 已改 |
| `app.less` | 仅 page 底色 | 注入 TDesign 主题变量 + 全局纸感样式 | ✅ 已改 |
| `variable.less` | 通用变量 | 保留兼容，新增 `styles/tokens.less` 为唯一来源 | ✅ 已改 |
| `custom-tab-bar/*` | 三项 tabbar | 四项：树洞/话题/文集/我的；去掉未读 badge（消息不在 Tab） | ✅ 已改 |
| `api/request.js` | 判断 `res.code === 200` | 先判 `statusCode` 再判业务 `code`；`ApiError` 统一；幂等头 | ✅ 已改 |
| `pages/home/*` | 双列卡片 + swiper | 单列内容流 + 筛选 + 周话题 + FAB | ✅ 已改 |
| `pages/message/*` | 聊天列表 + socket | 通知中心（回应/系统分段） | ✅ 已改 |
| `pages/my/*` | 个人中心 + 推荐服务 | 内容管理 + 社团区 + 设置 | ✅ 已改 |
| `pages/release/*` | 演示发布，`reLaunch` 返回 | 统一发布器 + 草稿 + 范围/身份 + 结果页跳转 | ✅ 已改 |
| `components/card` | 图片卡 | 由 `post-card` 取代，**删除** | ✅ 已删 |
| `components/nav` | 含"页面目录"抽屉（模板演示） | 由 `hg-nav` 取代，**删除** | ✅ 已删 |
| `mock/chat.js` | 聊天 mock + WebSocket 模拟 | **删除** | ✅ 已删 |
| `mock/dataCenter/` | 图表 mock | **删除** | ✅ 已删 |
| `mock/home/` | 卡片/轮播 mock | 由 `mock/community/` 取代，**删除** | ✅ 已删 |
| `mock/login/` | 验证码登录 mock | 替换为入社申请 mock（T-11） | ⬜ |
| `mock/my/` | 个人资料 + 推荐服务 | 替换为我的内容 mock | ✅ 已改 |
| `pages/chat/` | 聊天页 | **删除** | ✅ 已删 |
| `pages/loginCode/` | 验证码页 | **删除** | ✅ 已删 |
| `pages/dataCenter/` | 图表页 | **删除** | ✅ 已删 |
| `pages/login/` | 登录演示页 | **删除**，入社走 P12 | ✅ 已删 |
| `pages/search/*` | 历史+热搜 mock | 接权限内搜索 | ⬜ T-10 |
| `pages/setting/*` | 简单开关 | 隐私/缓存/导出/注销 | ⬜ T-12 |
| `pages/my/info-edit/*` | 含生日/地区表单 | 只保留昵称与头像 | ⬜ T-14 |
| `project.config.json` | condition 指向已删页面 | 更新编译条件 | ✅ 已改 |
| `package.json` | `test` 脚本仅报错 | **不改依赖**；测试策略见 10 章 | — |

## 9.3 已知模板缺陷（必须修复，不可沿用）

1. `api/request.js` 用 `res.code === 200` 判断成功 —— `wx.request` 返回体中是 `statusCode`，
   业务 code 在 `res.data.code`。当前写法在真实网络下会把成功判为失败。
2. `pages/release/index.js` 的 `saveDraft`/`release` 都用 `wx.reLaunch` 跳首页 —— 丢失返回栈，
   且无任何持久化。必须改为真实提交 + 结果页。
3. `app.js` 在 `onLaunch` 建立聊天 WebSocket —— 首版无 IM，属无效依赖，必须移除。
4. `components/nav` 内置"页面目录"抽屉是模板演示功能，会暴露全部页面路径，必须移除。
5. `mock/WxMock.js` 覆盖 `wx.request` 且不区分 method —— 需支持按 `method + path` 匹配（见 10 章）。
6. `pages/my/index.js` 用 `wx.getStorageSync('access_token')` 判断登录态 —— 会话状态必须
   经 `services/session.js` 统一管理，并区分"已登录"与"有效成员"。

## 9.4 删除前检查流程

```text
1. search_content 搜索目录名/组件名/函数名，确认零引用
2. 从 app.json（pages/subpackages/usingComponents）移除注册
3. 更新 project.config.json 的 condition 列表
4. 删除文件
5. 在开发者工具重新编译，确认无 "not found" 报错
```
