> 当前交接：[2026-09-23 开发交接](HANDOFF-2026-09-23.md)。

# 黑光文学社 · 树洞｜开发工程书

> 当前前端已接入 CloudBase 开发环境，运行时 Mock 与虚构数据已清除。下文记录早期 UI 基线和当时的任务分工，现状以项目根目录 `README.md`、最新交接及源码为准。

本目录是「黑光文学社树洞」微信小程序的**开发交接工程书**，供多个编程智能体并行开发使用。
基线代码库为当前仓库（TDesign 小程序通用模板），设计输入为 `D:\Github\blacklight\docs\heiguang_design`
下的策划文档（`product-plan.md`）、交互原型（`prototype.html`）与测试记录（`qa-report.md`）。

- 产品主张：留一盏灯，给每一种表达。
- 技术基线：原生微信小程序 + TDesign MiniProgram（不迁移 Taro/React/TS）。
- 首版四个底部入口：**树洞 / 话题 / 文集 / 我的**；消息在顶部入口；「写一笔」为悬浮主操作。

## 文档索引（建议按序阅读）

| 编号 | 文件 | 内容 | 主要读者 |
|---|---|---|---|
| 00 | `README.md` | 索引、交付边界、协作规则 | 全员 |
| 01 | `01-scope-and-decisions.md` | 产品范围、P0 边界、产品限制值、G0 阻断项、术语表 | 全员 |
| 02 | `02-architecture.md` | 分层、目录结构、请求/服务层、错误处理、编码规范 | 前端 |
| 03 | `03-routing-and-navigation.md` | 路由表、分包、页面参数契约、导航与返回栈规则 | 前端 |
| 04 | `04-data-model-and-api.md` | 实体与 DTO、接口契约、游标分页、幂等、错误码 | 前端 / 后端 |
| 05 | `05-permission-privacy.md` | 可见范围、匿名、权限矩阵、前端红线、越权验收用例 | 全员 |
| 06 | `06-ui-design-system.md` | 设计令牌、排版、色彩、TDesign 主题映射、适配与无障碍 | 前端 / 设计 |
| 07 | `07-component-contracts.md` | 组件清单与 props/events 契约 | 前端 |
| 08 | `08-page-specs.md` | P01–P18 逐页 UI 与交互实现规格 | 前端 |
| 09 | `09-template-migration.md` | 模板文件级改造清单（保留/改造/新增/移除） | 前端 |
| 10 | `10-mock-and-quality.md` | Mock 规范、测试策略、验收清单、lint/构建 | 全员 |
| 11 | `11-task-board.md` | 可并行任务分解（ID、依赖、输入输出、DoD） | 全员 |

## 当前代码交付状态（UI 基线）

本次已在仓库落地「设计系统 + 核心组件 + 四主 Tab + 写一笔 + 内容详情」的前端 UI 基线，
数据全部走 Mock。**未接入**微信登录、真实上传、服务端鉴权、内容审核与通知服务。

已实现：

- 设计令牌与全局主题：`styles/tokens.less`、`styles/mixins.less`、`styles/sheet.less`、`app.less`
- 自定义 TabBar 四入口：`custom-tab-bar/`
- 通用组件：`components/hg-nav`、`post-card`、`visibility-badge`、`topic-card`、
  `collection-cover`、`empty-state`、`scope-picker`
- 页面：`pages/home`（P01 树洞）、`pages/topics`（P02 话题广场）、`pages/anthology`（P06 文集）、
  `pages/my`（P09 我的）、`pages/message`（P08 消息）、`pages/release`（P04 写一笔）、
  `pages/community/post`（P05 详情/长文）、`pages/community/result`（P17 发布结果）、
  `pages/search`（P11 搜索）、`pages/setting`（P13 设置与隐私）、`pages/my/info-edit`（资料编辑）
- 传输与服务层：`api/request.js`（已修正 HTTP/业务码判断 + `ApiError`）、`api/endpoints.js`、`services/*`
- Mock：`mock/WxMock.js`（method + 路径参数匹配）、`mock/community/*`
- 导航兜底：`utils/navigate.js`（未实现页面给出明确提示，不静默失败）

待其他智能体实现（规格见 `08-page-specs.md`、任务见 `11-task-board.md`）：

- P03 话题详情、P07 文集目录、P10 我的内容列表、P12 加入文学社、P14 社团名片、
  P15 管理台、P16 社区约定、P18 社员主页
- 补齐组件：`identity-label`、`media-preview`、`request-state`、`comment-list`、`moderation-item`
- 上传链路（T-15）、评论提交闭环（T-06）、真实网络联调（T-17）

**已清理的模板遗留**：`pages/chat`、`pages/login`、`pages/loginCode`、`pages/dataCenter`、
`components/nav`、`components/card`、`mock/chat.js`、`mock/mock.js`、`mock/home|my|login|search|dataCenter`、
`static/chat`、`config/`、`pages/my/info-edit/areaData.js`。

## 协作规则（对编程智能体）

1. **先读 01/05/06 再写代码**：范围、权限与设计令牌是硬约束，界面细节可讨论，权限不可让步。
2. **一个任务一个分支/一次提交**，任务 ID 用 `11-task-board.md` 中的编号（如 `T-07 P03话题详情`）。
3. **不得新增依赖**（`package.json` 已冻结为 `tdesign-miniprogram`），不得引入 npm UI 库。
4. **不得在组件内直接请求数据**：组件只渲染入参、抛事件；数据在页面层，用例在 `services/`。
5. **不得用前端隐藏代替鉴权**：任何"隐藏按钮/隐藏分包"不构成安全边界，后端必须二次校验。
6. **尺寸单位统一 rpx**（设计基线 375px，1px = 2rpx），字体、圆角、间距一律取自设计令牌。
7. **文案禁止误导**：待审核不得写"发布成功，大家都能看到"；匿名不得写"绝对匿名/无法追踪"。
8. 修改公共文件（`app.json`、`app.less`、`styles/*`、`components/*`）前在任务板登记，避免冲突。

## 交付边界与免责

- 本工程书是设计与实现规格，不构成法务合规结论。上线前须完成 `01` 中的 **G0 核验**。
- 原型中的昵称、正文、计数、活动、照片均为虚构或内部评审占位素材，禁止直接用于生产发布。
- Mock 数据仅用于界面联调；任何"界面上看不到"不等于"服务端已鉴权"。
