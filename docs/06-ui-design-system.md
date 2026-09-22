# 06｜UI 设计系统（纸感 · 墨绿）

> 设计语言：**暖纸底、深墨绿、鼠尾草绿、少量赭色**。文学感来自排版与阅读节奏，不靠贴纸与纹理堆叠。
> 唯一实现来源：`styles/tokens.less`。页面与组件 **禁止** 出现裸色值。

## 6.1 设计基线

- 设计稿基准宽度 **375px**（原型评审 390px，须同时检查 375 / 430）。
- 换算：`1px = 2rpx`。文档中标注 px 的字号在代码里写 rpx（× 2）。
- 触控目标最小 **44 × 44 px（88rpx）**；图标小时用透明区扩大。
- 安全区：底部使用 `env(safe-area-inset-bottom)`；自定义导航用 `wx.getWindowInfo().statusBarHeight`。

## 6.2 色彩令牌

| 令牌 | 值 | 用途 |
|---|---|---|
| `@hg-paper` | `#F8F6F0` | 页面底色（暖纸白） |
| `@hg-surface` | `#FFFEFA` | 卡片/内容面 |
| `@hg-surface-sunk` | `#EFEEE6` | 搜索框、分段控件底 |
| `@hg-ink` | `#223B32` | 正文主色（深墨） |
| `@hg-ink-2` | `#4C5B4A` | 卡片正文 |
| `@hg-ink-3` | `#7D8177` | 次要文字 |
| `@hg-ink-4` | `#9CA393` | 时间、计数、占位 |
| `@hg-green` | `#315948` | 主色：主按钮、选中态、Tab 选中 |
| `@hg-green-soft` | `#E9EEE4` | 话题块、周话题卡背景 |
| `@hg-green-mist` | `#E6ECDF` | 区块背景（话题 banner、名片 hero） |
| `@hg-clay` | `#AD724C` | 强调：本周话题、未读点、激活的共鸣 |
| `@hg-clay-soft` | `#F3E7D7` | 提示条背景 |
| `@hg-danger` | `#A85648` | 危险操作与错误 |
| `@hg-line` | `#E7E7DD` | 分割线、卡片描边 |
| `@hg-line-strong` | `#D7DDCF` | 区块分隔 |
| `@hg-reading-bg` | `#26362D` | 夜间阅读底 |
| `@hg-reading-fg` | `#D1D8C9` | 夜间阅读文字 |

**范围标识配色**（与 `visibility-badge` 一一对应）

| 范围 | 背景 | 文字 |
|---|---|---|
| `club` | `#F0F2E9` | `#7A866D` |
| `public` | `#F1EADF` | `#9E7950` |
| `private` | `#ECEBF0` | `#837B92` |
| `pending`（状态标签） | `#F4E8D2` | `#9A7D4E` |

> 颜色**不得**单独承担语义：范围标识必须同时有图标 + 文字。

## 6.3 字体与排版

```less
@hg-font-serif: "Songti SC", "Noto Serif CJK SC", "SimSun", serif;   // 标题、长文
@hg-font-sans: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; // 正文、操作
```

不打包额外字体文件。

| 令牌 | 字号(px/rpx) | 行高 | 字族 | 用途 |
|---|---|---|---|---|
| `@hg-fs-display` | 27 / 54 | 1.5 | serif | 页面大标题（树洞欢迎语、加入页） |
| `@hg-fs-title` | 24 / 48 | 1.55 | serif | 弹层标题、成功页标题、文集名 |
| `@hg-fs-h2` | 19 / 38 | 1.65 | serif | 卡片文章标题、区块标题 |
| `@hg-fs-h3` | 16 / 32 | 1.6 | serif | 目录条目、小节 |
| `@hg-fs-body` | 14 / 28 | 1.9 | sans | 卡片正文、表单 |
| `@hg-fs-body-lg` | 16 / 32 | 2.0 | sans | 碎片详情正文 |
| `@hg-fs-reading` | 17 / 34 | 2.15 | serif | 长文阅读（可调 15/17/19） |
| `@hg-fs-sm` | 12 / 24 | 1.8 | sans | 说明、次要操作 |
| `@hg-fs-xs` | 11 / 22 | 1.7 | sans | 筛选、标签 |
| `@hg-fs-2xs` | 10 / 20 | 1.8 | sans | 时间、计数、脚注 |

排版规则：长文保留换行与空行（诗歌）；`white-space: pre-wrap`；段间距 `1.25em`；
引用块左侧 2rpx 竖线 + `@hg-green-soft` 系文字色。

## 6.4 间距、圆角、阴影

```less
@hg-sp-1: 8rpx;  @hg-sp-2: 16rpx;  @hg-sp-3: 24rpx;
@hg-sp-4: 32rpx; @hg-sp-5: 40rpx;  @hg-sp-6: 48rpx;

@hg-radius-sm: 10rpx;   // 标签、图片
@hg-radius-md: 16rpx;   // 输入、按钮
@hg-radius-lg: 26rpx;   // 卡片
@hg-radius-xl: 46rpx;   // 底部弹层
@hg-radius-pill: 999rpx;

@hg-shadow-card: 0 2rpx 12rpx rgba(34, 59, 50, 0.05);
@hg-shadow-fab: 0 12rpx 28rpx rgba(23, 59, 66, 0.19);
@hg-shadow-book: 6rpx 12rpx 24rpx rgba(35, 56, 39, 0.10);
```

页面水平内边距统一 **28rpx**（列表页 `feed` 用 28rpx，区块 hero 用 38rpx）。

## 6.5 关键构件视觉规格

| 构件 | 规格 |
|---|---|
| 自定义导航 | 高 100rpx + 状态栏；纸底无阴影；标题 30rpx/600；右侧工具 72rpx 方块 |
| 搜索条 | 高 78rpx，`@hg-surface-sunk`，圆角 20rpx，占位 24rpx |
| 本周共写卡 | 最小高 238rpx，`@hg-green-mist`，圆角 24rpx，右下装饰图案 opacity .75 |
| 筛选 chip | 高 64rpx，圆角 34rpx，未选文字 `@hg-ink-3`，选中 `@hg-green` 底 + 纸色字 |
| 内容卡 | `@hg-surface` + 1rpx `@hg-line` 描边 + 圆角 26rpx + 内距 30rpx + 间距 24rpx |
| 头像 | 66rpx 圆形；署名 `#E0E7D4/#62734D`；匿名 `#EEE9DD/#9E947C` |
| 图片 | 单图高 360rpx；双列网格每格 272rpx；`aspectFill` |
| 视频占位 | 中央 92rpx 半透明圆 + 播放三角；右下时长胶囊 |
| 话题链接 | 内联 chip，`#F1F3E9` 底、`#718566` 字、圆角 12rpx、最小高 58rpx |
| 操作条 | 图标 32rpx + 20rpx 文字，间距 34rpx；激活态 `@hg-clay` |
| 主按钮 | 高 88rpx，`@hg-green` 底，纸色字，圆角 18rpx |
| 次按钮 | 高 84rpx，`#F8F9F1` 底 + `#D9DFCF` 描边 |
| FAB「写一笔」 | 高 86rpx 胶囊，右 36rpx，距 TabBar 上 190rpx，`@hg-shadow-fab` |
| TabBar | 高 112rpx + 安全区；选中 `@hg-green` 且线宽加粗；未选 `#969D92` |
| 书脊封面 | 宽高比 3:4，左侧 16rpx 深色书脊，右下装饰圆环，`@hg-shadow-book` |
| 底部弹层 | 顶部圆角 46rpx，纸底，最大高 85%，标题 40rpx serif |
| Toast | 深墨底 `rgba(41,62,49,.92)`，圆角 18rpx，底部距 248rpx |
| 空态 | 126rpx 圆形图标底 `#E8EDDF` + 38rpx 标题 + 24rpx 说明 + 可选主按钮 |

## 6.6 TDesign 主题映射

统一在 `app.less` 用 CSS 变量覆盖，不逐页重写：

```less
page {
  --td-brand-color: @hg-green;
  --td-brand-color-active: darken(@hg-green, 6%);
  --td-brand-color-light: @hg-green-soft;
  --td-text-color-primary: @hg-ink;
  --td-text-color-secondary: @hg-ink-3;
  --td-text-color-placeholder: @hg-ink-4;
  --td-bg-color-page: @hg-paper;
  --td-bg-color-container: @hg-surface;
  --td-border-level-1-color: @hg-line;
  --td-radius-default: @hg-radius-md;
  --td-warning-color: @hg-clay;
  --td-error-color: @hg-danger;
  --td-font-size-m: @hg-fs-body;
}
```

允许使用的 TDesign 组件：`navbar`、`search`、`tabs`、`tab-panel`、`tab-bar`、`button`、`cell`、
`cell-group`、`tag`、`textarea`、`upload`、`popup`、`action-sheet`、`dialog`、`toast`、`message`、
`image`、`avatar`、`divider`、`switch`、`checkbox`、`radio`、`loading`、`pull-down-refresh`、`empty`、`skeleton`。

自定义组件优先用于承载业务语义（`post-card`、`visibility-badge` 等），不把 TDesign 组件当业务组件用。

## 6.7 动效与反馈

- 过渡时长 160–220ms，`ease-out`；尊重 `prefers-reduced-motion`（小程序端至少不做长动画）。
- 共鸣/收藏：立即乐观更新 + 失败回滚 + toast 说明；**不跳转、不冒泡**（`catchtap`）。
- 视频**不自动播放、不自动出声**。
- 加载：首屏用 `t-skeleton`；分页加载用底部 24rpx 文案，不用整页遮罩。
- 错误：保留已加载内容 + 顶部"未更新"提示条 + 重试按钮。

## 6.8 无障碍与适配

- 所有可点区域使用 `button`/`view` + `aria-role`（小程序用 `aria-role="button"`）与 `aria-label`。
- 图片必须有 `alt` 语义（用 `aria-label` 承载）；装饰图 `aria-hidden`。
- 文字与背景对比度：正文 ≥ 4.5:1，大字 ≥ 3:1。范围标识不得只靠颜色。
- 长文提供字号三档（15/17/19px）与夜间配色，设置存本地（账号作用域）。
- 键盘弹出：编辑器用 `adjust-position`，底部操作栏随键盘上移，不遮挡提交按钮。
- 检查 375 / 390 / 430 三种宽度无横向溢出（原型 QA 第 27 项）。

## 6.9 文案风格

- 简短、具体、不催促。示例："写下第一笔" 优于 "快来发布吧"。
- 不制造红点焦虑：无未读不显示点；共鸣聚合展示。
- 不使用"守护/全天候/绝对安全"等承诺式表达。
- 空态说明两行以内，给出一个明确的下一步动作。
