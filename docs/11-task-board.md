# 11｜并行任务板（给编程智能体）

> 领取任务前必读：`01`（范围）、`05`（权限）、`06`（设计令牌）、`07`（组件契约）。
> 每个任务的 DoD 都包含："`npm run lint` 通过" + "开发者工具编译无报错" + "10.4 清单相关项自测通过"。
>
> **状态说明（2026-09-23）**：下方“已完成 / 待领取”是原任务板分组，尚未反映后续集成与验收结果。逐项代码、本地记录、云端记录及未验收项见[前端任务审计](frontend-task-audit-2026-09-23.md)。页面或路由存在不等于验收通过；原规格保留供实现和复核。

## 已完成（原基线分组，当前状态见审计报告）

| ID | 内容 | 产出 |
|---|---|---|
| T-00 | 工程书编写 | `docs/00–11` |
| T-01 | 设计令牌与全局主题 | `styles/tokens.less`、`styles/mixins.less`、`app.less`、`variable.less` |
| T-02a | 基础组件（部分） | `hg-nav`、`post-card`、`visibility-badge`、`topic-card`、`collection-cover`、`empty-state`、`scope-picker` |
| T-03 | 骨架清理与路由 | `app.json`、`app.js`、`custom-tab-bar`、删除 chat/login/loginCode/dataCenter |
| T-04a | 四主 Tab 页面 | `pages/home`、`pages/topics`、`pages/anthology`、`pages/my` |
| T-04b | 消息中心 | `pages/message` |
| T-04c | 写一笔基线 | `pages/release` |
| T-04d | 内容详情/长文基线 | `pages/community/post` |
| T-04e | 服务层与 Mock | `api/request.js`、`api/endpoints.js`、`services/*`、`mock/community/*` |
| T-05 | P17 发布结果页 | `pages/community/result` |
| T-10 | P11 搜索改造 | `pages/search`、`services/search.js`、搜索 Mock |
| T-12a | P13 设置与隐私 | `pages/setting`（P16 约定页仍待建） |
| T-14a | 资料编辑精简 | `pages/my/info-edit`（已移除生日/地区字段与 `areaData.js`） |
| T-16 | WxMock 增强 | `mock/WxMock.js` 支持 method + 路径参数 + 函数式响应 + 穿透 |

---

## 待领取任务（原任务清单，当前状态见审计报告）

### T-02b｜补齐基础组件
**依赖**：无（可立即开始）
**输入**：`07-component-contracts.md` 7.5 / 7.6 / 7.11
**产出**：`components/identity-label`、`components/media-preview`、`components/request-state`
**DoD**
- 三个组件均有 `.js/.json/.wxml/.less`，`component: true`
- `identity-label` 匿名态点击只抛 `explain`，不抛 `tapname`
- `media-preview` 1 图满宽 / 2–9 图两列；视频 `ready=false` 显示处理中占位、无播放按钮
- `request-state` 在 `error` 时保留旧数据、显示"未更新"提示条 + 重试
- 将 `post-card` 中的内联媒体与身份渲染替换为这两个组件（保持对外事件不变）

### T-06｜P05 评论区与互动闭环
**依赖**：T-02b
**输入**：`07` 7.9、`08` P05、`04` B8/B9
**产出**：`components/comment-list/`、`pages/community/post` 评论区接入、`services/posts.js` 评论用例
**DoD**
- 一级评论 + 定向回复，无嵌套
- 提交后本地插入"等待审核"占位，状态文案明确
- `commentsEnabled=false` 隐藏输入区并说明原因
- 匿名帖中作者回复带"作者"标记且不露真实昵称
- 共鸣/收藏乐观更新 + 失败回滚 + toast

### T-07｜P03 话题详情
**依赖**：无
**输入**：`08` P03、`04` C2/C4
**产出**：`pages/community/topic/`、`services/topics.js` 详情与关注用例、`mock/community/topics.js` 扩充
**DoD**
- banner + 参与列表 + 底部"我也写一笔"（带 `topicId`，不预选匿名/范围）
- `archived` 态主按钮置灰并说明
- 空态、加载、失败三态
- 关注说明文案体现"不发站外通知"

### T-08｜P07 文集目录与投稿授权
**依赖**：无
**输入**：`08` P07、`04` D2/D3/D4
**产出**：`pages/community/collection/`、`services/collections.js` 目录与投稿用例
**DoD**
- hero + 目录 + 投稿入口；目录点击进 P05 且返回回到本目录
- 投稿跳 P04 携带 `collectionId`，页面顶部显示文集范围提示
- 授权复选框未勾选时提交按钮禁用
- 公开文集不接收社内原帖的提示文案存在

### T-09｜P10 我的内容列表
**依赖**：无
**输入**：`08` P10、`04` J3
**产出**：`pages/community/my-content/`、`services/posts.js` 我的内容用例
**DoD**
- 单页六 tab 切换（`published/pending/draft/private/bookmark/topics`）
- 待审不混入已发布；退回显示理由与"重新编辑"
- 失效收藏显示占位且可移除，无摘要残留
- 草稿删除与内容删除分别二次确认

### T-11｜P12 加入文学社 + P14 社团名片
**依赖**：无
**输入**：`08` P12/P14、`04` A1/A3/A4
**产出**：`pages/community/join/`、`pages/community/club/`、`services/session.js` 入社用例、
`mock/community/session.js` 扩充（替换 `mock/login/`）
**DoD**
- 六种申请状态文案齐备
- 阅读规则跳 P16 返回**保留输入**
- 不采集手机号/位置/学号；邀请码不硬编码在前端
- 名片页访客视角不显示成员名册与社内活动细节

### T-12b｜P16 社区约定 + 设置页接真实接口
**依赖**：无
**输入**：`08` P13/P16、`05.7` 文案基线
**产出**：新增 `pages/community/rules/`；`pages/setting/` 的导出与注销接 `04` J1/J2
**DoD**
- 约定页保留原三项来源说明 + 新增六条，三层规则（社团约定 / 平台要求 / 法律义务）分清
- 版本号与变更摘要展示（当前 Mock 为 `v1.1`）
- 导出与注销走真实异步任务与状态回显，失败显示"待处理"而非虚假完成
- 设置页现有 UI 与文案不得改动（已按 `05.7` 定稿）

### T-13｜P15 管理台
**依赖**：T-02b
**输入**：`08` P15、`04` I1/I2/I3、`05.2`
**产出**：`pages/admin/`（新分包）、`components/moderation-item/`、`services/moderation.js`、
`mock/community/moderation.js`
**DoD**
- 五队列分段 + 条目 + 动作 + 理由弹层（理由必填）
- 使用 `expectedVersion`，重复提交幂等
- 非授权角色进入显示无权提示（不白屏）
- 不展示匿名映射、私密手记、举报人身份
- 页面注释明确写"分包不是安全边界"

### T-14b｜P18 社员主页 + 资料保存接口
**依赖**：无
**输入**：`08` P18
**产出**：`pages/community/profile/`；`pages/my/info-edit/` 的保存与头像上传接入
**DoD**
- 仅展示署名且可见的作品；无私信/关注按钮
- 匿名帖作者点击不进入本页（当前由 `post-card` 抛 `userId: null` 保证，勿改契约）
- 资料保存走真实接口，头像走 `04` G1 上传意图
- 资料页仍不得新增生日/院系/学号等字段

### T-15｜上传链路与媒体校验
**依赖**：T-02b
**输入**：`04` G1/G2、`04.7`、`01.5`
**产出**：`services/uploads.js`、`pages/release` 媒体接入
**DoD**
- 选择 → 校验（数量/大小/时长/互斥）→ 上传意图 → 逐个上传 → 轮询状态
- 单附件失败可单独重试；整体失败保留草稿
- 视频能力关闭时入口置灰并说明
- 上传中禁止重复提交

### T-17｜真实网络联调开关
**依赖**：T-16、后端可用
**输入**：`02.3`、`04.6`
**产出**：`config.js` 增加环境切换、`api/request.js` 联调修正
**DoD**
- `isMock = false` 时可打通 `/session/me` 与 `/posts`
- 十类 `ApiError.kind` 均有对应 UI 表现验证记录

---

## 冲突避免规则

以下文件为**多任务共享**，修改前在此表登记（提交信息带任务 ID）：

| 文件 | 当前持有 | 备注 |
|---|---|---|
| `app.json` | 空闲 | 新增页面时只 append 自己的路径 |
| `app.less` / `styles/tokens.less` | 空闲 | 新增令牌不改已有值；改值需评审 |
| `components/post-card/*` | T-02b | 替换内部媒体/身份渲染 |
| `api/request.js` | T-17 | 其他任务不改 |
| `services/posts.js` | T-06 / T-09 | 各自新增函数，不重构已有函数 |
| `mock/community/index.js` | 空闲 | 只 append 路由，不改已有路由的过滤逻辑 |
| `utils/navigate.js` | 各任务 | 实现完自己的页面后，从 `PENDING_PAGES` 删掉对应条目 |

## 新页面接入检查单（每个任务收尾必做）

1. 在 `app.json` 的 `pages/community` 分包 `pages` 数组中 append 自己的路径。
2. 从 `utils/navigate.js` 的 `PENDING_PAGES` 中删除对应条目。
3. 在 `project.config.json` 的 `condition.miniprogram.list` 中加一条编译条件，便于评审直达。
4. 页面必须实现 loading / error(可重试) / empty 三态。
5. 页面 `.json` 文件保存为**无 BOM 的 UTF-8**（小程序编译器对 BOM 报 JSON 解析错）。
6. 所有色值、字号、间距从 `styles/tokens.less` 取；弹层与表单复用 `styles/sheet.less`。
7. 自查权限红线：`docs/05` 5.6 清单逐条过一遍。
