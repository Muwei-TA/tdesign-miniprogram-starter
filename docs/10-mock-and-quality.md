# 10｜Mock 规范、测试策略与验收清单

## 10.1 Mock 架构

```text
mock/
  index.js              # 装载入口，由 app.js 在 config.isMock 时调用
  WxMock.js             # 拦截 wx.request（需支持 method + path 匹配）
  community/
    index.js            # 汇总导出
    session.js          # /session/me、capabilities、角色切换
    posts.js            # /posts 列表、详情、发布、互动
    topics.js           # /topics 列表、详情
    collections.js      # /collections 列表、目录
    notifications.js    # /notifications
    search.js           # /search、/search/suggestions
    my.js               # /me/contents
```

**Mock 数据规则**

1. 所有昵称、正文、计数、活动、图片均为**虚构或本地占位**；不得引入外部真实素材。
2. 必须覆盖三种角色视角：`guest` / `member` / `admin`，通过 `mock/community/session.js`
   的 `MOCK_ROLE` 常量切换（开发时手改，不做界面开关，避免被误认为产品权限）。
3. 必须包含以下边界数据（用于 UI 三态验证）：
   - `private` 帖（验证不进入信息流与搜索）
   - `pending` 帖（本人可见，带状态标签）
   - `rejected` 帖（含退回理由）
   - 匿名帖（`author.userId = null` + `alias`）
   - 视频帖 `ready = false`（处理中占位）
   - 空文集、已归档话题、失效收藏占位
4. Mock 响应包装与真实契约一致：`{ code: 0, message, data }`；列表带 `nextCursor`。
5. Mock **不得**返回任何越权数据用于"方便调试"：`guest` 视角下社内帖必须真的不在响应里。

## 10.2 WxMock 改造要求

当前 `mock/WxMock.js` 只按 `config.url` 精确匹配，且不区分 method。需要：

```text
- 支持 method 区分：键为 `${method} ${path}`
- 支持 query 剥离：/posts?cursor=x 命中 /posts
- 支持路径参数：/posts/:id
- 支持函数式响应：response(({ method, path, params, query, body })) => data
- 保留穿透：未命中的请求走原 wx.request
```

## 10.3 测试策略

模板 `package.json` 的 `test` 脚本仅输出错误，**不得**当作已有测试覆盖。首版要求：

| 层级 | 方式 | 范围 |
|---|---|---|
| 纯函数单测 | 可选（无测试框架依赖时用 `node scripts/*.js` 断言脚本） | 时间格式化、字数统计、幂等键、范围收缩合法性 |
| 服务层用例 | 手工用例清单 + Mock 驱动 | 发布时序、错误码分支、游标分页 |
| 页面手工测试 | `10.4` 清单逐项 | 三种角色 × 18 页 |
| 真机测试 | iOS + 低端 Android | 键盘、安全区、长文换行、图片预览、视频播放/返回停止 |

**不得**为了引入 Jest 而改 `package.json` 依赖；若必须，先在任务板申请并单独评审。

## 10.4 UI 手工验收清单

### 权限组（P0，任一失败即停止相关能力）

- [ ] 访客视角：社内/私密内容不在列表、计数、搜索结果中出现。
- [ ] 访客深链进入社内帖：显示统一不可访问态，不显示标题。
- [ ] 普通成员搜索他人私密帖的唯一词：0 结果且无摘要泄露。
- [ ] 搜索匿名作者真实昵称：不返回其匿名帖。
- [ ] 匿名帖详情与评论区：无真实昵称、无主页跳转、作者回复带"作者"标记。
- [ ] 公开帖改社内后：另一账号刷新收藏列表 → 显示占位，无旧摘要/封面。
- [ ] 退出登录后：storage 中无 `hg:{previousUserId}:` 前缀残留。
- [ ] `capabilities.publicScope = false`：范围选择器无 public 选项，提交不带该值。
- [ ] 普通成员访问 `pages/admin/index` 深链：接口返回 403，页面显示无权提示。

### 发布组

- [ ] 空内容不可提交；纯图/纯视频可提交；文章缺标题被拦截并定位。
- [ ] 字数超限：碎片提示切文章（内容不丢）；文章超限阻止提交。
- [ ] 图片 10 张被拒；单张 >10MB 被拒并说明。
- [ ] 图片与视频互斥生效。
- [ ] 上传中重复点击提交无效（按钮 loading + 幂等键）。
- [ ] 杀进程/切后台后重进：草稿可恢复（含范围与身份选择；视频需重选并有说明）。
- [ ] 提交超时后重试：只产生一条内容。
- [ ] 结果页文案与真实状态一致，无"大家都能看到"误导。

### 治理组

- [ ] 举报提交有回执，文案不认定违规。
- [ ] 管理台退回必须填理由；退回内容在 P10 可看理由并重新编辑。
- [ ] 取消编辑不删除原退回记录。
- [ ] 文集流程：安全通过 → 编辑收录 → 目录更新；撤回授权 → 目录移除。
- [ ] 缩小范围与删除均有二次确认，且提示截图无法追回。

### 阅读与适配组

- [ ] 375 / 390 / 430 三宽度下 18 页无横向溢出。
- [ ] 长文字号三档与夜间模式生效并持久化；诗歌空行保留。
- [ ] 图片预览可关闭；视频返回时停止播放、不自动播放、不自动出声。
- [ ] 列表返回保留滚动位置；Tab 切换不重启小程序。
- [ ] 键盘弹出不遮挡提交按钮；安全区底部不被 TabBar 压住。
- [ ] 空态/加载/失败三态在每个列表页均可触发验证。

## 10.5 lint 与构建

```bash
npm install          # 首次（仓库当前未安装 node_modules）
npm run lint         # 提交前必过
```

微信开发者工具：导入项目 → 构建 npm → 编译。基础库按 `project.config.json`。
**注意**：`miniprogram_npm` 已在仓库中，如改动 `package.json` 需重新构建 npm（首版不改）。

### 无依赖下的静态自检（推荐，无需 npm install）

```bash
node scripts/check.mjs      # 每个任务收尾必跑，退出码非 0 视为不通过
```

该脚本检查四项：

| 检查 | 内容 | 判定 |
|---|---|---|
| 语法 | 逐文件 `node --check`；JSON 解析 + **BOM 检测** | 0 error |
| 模板事件绑定 | 提取 `bind:*` / `catch*` 处理函数名，比对同目录 `.js`；顺带拦截 `<br>` | 无 missing handler |
| 组件注册 | `usingComponents` 路径存在性 + WXML 自定义标签已注册 | 无 unregistered |
| 路由 | `app.json` 页面文件齐全；代码跳转目标已注册或在 `utils/navigate.js` 的待实现清单中 | 无 unregistered route |

**常见坑（已在基线中踩过）**

1. `.json` 文件带 UTF-8 BOM → 小程序编译报 JSON 解析错。保存时必须无 BOM。
2. WXML **不支持 `<br />`**，换行用嵌套 `<view>` 或 `\n` + `white-space: pre-wrap`。
3. `wx:if` 里不能写 `bind:action="{{ cond ? 'a' : 'b' }}"` 这种动态事件名，必须在 JS 里分支。
4. 同一 LESS 文件里全局类名与 mixin 同名（如 `.hg-notice` 与 `.hg-notice()`）会造成歧义，
   全局类统一加 `-block` 后缀。
5. `page.json` 中 TDesign 组件路径写 `tdesign-miniprogram/xxx/xxx`（不带 `/miniprogram_npm` 前缀）。

## 10.6 明确未覆盖（交付时必须如实声明）

未执行：真机测试、真实网络与后端联调、恶意越权渗透测试、跨账号原生存储测试、
真云端删除、微信分享链路、资质审核、真实用户访谈与可用性研究。
角色切换只验证虚构数据下的界面分支，**不能证明任何真实数据安全**。
