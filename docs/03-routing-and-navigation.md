# 03｜路由、分包与导航契约

## 3.1 主包与 TabBar

主包只放四个 Tab 页与体积最小的公共资源。

| Tab | 路径 | 图标（TDesign） | 标题 |
|---|---|---|---|
| 树洞 | `pages/home/index` | `leaf` → 回退 `home` | 树洞 |
| 话题 | `pages/topics/index` | `chat-bubble-1` → 回退 `chat` | 话题 |
| 文集 | `pages/anthology/index` | `book-open` → 回退 `books` | 文集 |
| 我的 | `pages/my/index` | `user` | 我的 |

> TDesign 图标名需以实际 `miniprogram_npm/tdesign-miniprogram/icon` 支持为准；
> 不存在时用回退名，禁止引入外部图标字体文件。

`app.json` 目标 `tabBar.custom = true`，四项 list 与上表一致；消息**不占 Tab**，从 P01 顶部进入。

## 3.2 分包

| 分包 root | name | 页面 | 说明 |
|---|---|---|---|
| `pages/community` | community | `post`、`topic`、`collection`、`my-content`、`club`、`join`、`rules`、`result`、`profile` | 社区业务详情与配套 |
| `pages/search` | search | `index` | 搜索（保留模板分包） |
| `pages/setting` | setting | `index` | 设置与隐私 |
| `pages/release` | release | `index` | 写一笔（统一发布器） |
| `pages/admin` | admin | `index` | 管理台；**分包不是安全边界**，接口必须鉴权 |
| `pages/my/info-edit` | edit | `index` | 昵称/头像编辑（保留，去掉生日/院系等采集） |

移除分包：`chat`、`loginCode`、`dataCenter`、`login`（改为 `pages/community/join` 承接入社，
微信登录作为 `join` 页内的授权步骤，不单独做登录页）。

## 3.3 页面参数契约

| 页面 | 参数 | 必填 | 说明 |
|---|---|---|---|
| `community/post` | `id`、`from` | `id` 必填 | `from ∈ feed/topic/search/collection/notice/mine`，用于返回与埋点 |
| `community/topic` | `id` | 是 | 话题详情 |
| `community/collection` | `id` | 是 | 文集目录 |
| `community/my-content` | `tab` | 是 | `published/pending/draft/private/bookmark/topics` |
| `community/profile` | `userId` | 是 | 仅署名作者；匿名作者禁止进入 |
| `community/result` | `state`、`scope`、`identity`、`id` | `state` 必填 | `state ∈ pending/private_saved/published` |
| `community/join` | `from` | 否 | 记录拦截来源，服务端确认入社后回到原场景 |
| `release/index` | `draftId`、`topicId`、`mode`、`collectionId` | 否 | `mode ∈ fragment/article`；`collectionId` 表示文集投稿 |
| `search/index` | `keyword` | 否 | 预填关键词 |
| `admin/index` | `queue` | 否 | `content/topic/member/report/collection` |

**参数规则**

1. 只传 ID 与视图意图，**不得**在 URL 传正文、标题、昵称、alias、scope 之外的业务数据。
2. 详情页必须用 `id` 重新拉取详情，不信任列表页传来的内容（列表数据可能已过期/越权）。
3. `community/profile` 的 `userId` 由服务端返回的署名作者字段提供；匿名帖不返回 `userId`。

## 3.4 导航与返回栈规则

- Tab 间切换：`wx.switchTab`；进入详情/编辑器：`wx.navigateTo`；层级超限（10 层）时 `redirectTo`。
- **禁止**用 `reLaunch` 做常规返回。仅"退出账号""成员资格失效"时允许 `reLaunch` 到 P01。
- 发布链路：`release → (提交成功) → redirectTo community/result`，`result` 页的"回树洞"用 `switchTab`。
  这样返回栈不会残留编辑器。
- 详情页返回：`navigateBack`，由来源页自行刷新局部状态（通过 `app.eventBus` 广播 `post-changed`）。
- 编辑器离开确认：`onUnload` 前用 `wx.showModal` 提供三选项——
  「存草稿离开」/「不保留」/「继续写」。用户点系统返回也必须触发（用 `onBackPress` 不可用时，
  在 `t-navbar` 自定义返回按钮上拦截；系统手势返回则在 `onHide/onUnload` 中静默存草稿并 toast 提示）。

## 3.5 跨页通信

统一用 `app.eventBus`（已存在 `utils/eventBus.js`），事件名与载荷：

| 事件 | 载荷 | 触发方 | 订阅方 |
|---|---|---|---|
| `post-changed` | `{ id, action }` `action ∈ react/bookmark/visibility/delete/comment` | 详情页、管理台 | P01/P03/P07/P10 |
| `post-created` | `{ id, state }` | 发布结果页 | P01、P10 |
| `draft-changed` | `{ draftId }` | 编辑器 | P10（草稿列表） |
| `notice-unread-change` | `number` | 消息服务 | P01 顶部红点、P09 |
| `session-changed` | `{ role, memberStatus }` | session 服务 | 所有 Tab 页 |

订阅必须在 `onUnload` 中解绑，避免页面栈泄漏。

## 3.6 分享与深链

- 社内内容分享卡片统一中性文案（不带标题与正文摘要），目标页打开时**重新鉴权**。
- 仅自己内容禁止分享入口。
- 深链进入无权内容：显示统一"内容当前不可访问"，提供"回树洞"按钮，不显示标题。
