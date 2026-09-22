# 黑光文学社 · 树洞

留一盏灯，给每一种表达。

一个大学文学社的微信小程序社区：成员可以发一句话、一张照片、一个未成形的故事或一篇文章；
**先决定谁能看见，再决定用什么身份写**；他人可以回应、共鸣、收藏；作者明确授权后，文章可进入社团文集。

- 技术基线：原生微信小程序 + [TDesign MiniProgram](https://tdesign.tencent.com/miniprogram/overview)（不引入新依赖）
- 四个底部入口：**树洞 / 话题 / 文集 / 我的**；消息在树洞首页顶部；「写一笔」为悬浮主操作
- 当前状态：**前端 UI 基线 + Mock 数据**。未接入微信登录、真实上传、服务端鉴权、内容审核与通知服务

## 开发工程书

完整交接文档在 [`docs/`](./docs/README.md)。开始写代码前至少读这四篇：

| 文档 | 为什么必读 |
|---|---|
| [`docs/01-scope-and-decisions.md`](./docs/01-scope-and-decisions.md) | 范围边界、产品限制值、术语表、G0 上线阻断项 |
| [`docs/05-permission-privacy.md`](./docs/05-permission-privacy.md) | 可见范围与匿名的硬规则，违反即 P0 |
| [`docs/06-ui-design-system.md`](./docs/06-ui-design-system.md) | 设计令牌，页面禁止写裸色值 |
| [`docs/11-task-board.md`](./docs/11-task-board.md) | 可并行领取的任务、DoD 与冲突避免规则 |

## 本地运行

```bash
npm install     # 首次；仅用于 eslint/prettier，运行小程序本身不需要
```

1. 用微信开发者工具导入本目录（`miniprogram_npm` 已随仓库提供）。
2. 如改动过 `package.json`，需「工具 → 构建 npm」。
3. 编译预览。默认 `config.js` 的 `isMock = true`，全部数据来自 `mock/`。

## 提交前自检

```bash
node scripts/check.mjs    # 零依赖静态自检：语法 / BOM / 事件绑定 / 组件注册 / 路由
npm run lint              # 需要先 npm install
```

自检覆盖的常见坑见 [`docs/10-mock-and-quality.md`](./docs/10-mock-and-quality.md) 10.5。

## 目录结构

```text
api/            传输层：请求封装、接口路径常量
services/       用例层：会话、内容、话题、文集、通知、搜索、草稿、上传、管理
components/     展示组件：只渲染入参、只抛事件，不请求数据、不判断权限
pages/          页面：界面状态、导航、事件编排
  home/         P01 树洞    topics/    P02 话题    anthology/ P06 文集    my/  P09 我的
  message/      P08 消息    release/   P04 写一笔  search/    P11 搜索    setting/ P13 设置
  community/    分包：post（P05 详情/长文）、result（P17 发布结果）
styles/         设计令牌与 mixin（唯一色值/字号来源）
mock/           Mock 拦截与虚构数据（仅 isMock 时装载）
scripts/        零依赖静态自检
docs/           开发工程书
```

## 边界声明

- 文档与代码中的昵称、正文、计数、活动、图片均为**虚构或本地占位**，不得直接用于生产发布。
- 界面上看不到某条内容**不等于**服务端已完成鉴权；真实的成员鉴权、匿名映射隔离、媒体授权、
  内容审核、审计与删除流程必须由后端实现。
- 上线前须完成 `docs/01` 中的 **G0 核验**（主体资质、服务类目、内容安全能力、隐私告知、素材授权）。

## 开源协议

沿用模板的 [MIT 协议](./LICENSE)。
