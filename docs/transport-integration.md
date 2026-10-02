# 小程序 API 传输层

页面和 service 继续使用 HTTP 风格 endpoint。`api/transport.js` 将 endpoint、method、query 和 body 映射为后端 action/payload；传输方式由 `config.js` profile 决定，业务 action 与幂等键保持共用。

## 运行 profile

`cloudbase` 是当前默认值，继续使用在线的 `api` 云函数。`nasLanDevelopment` 仅用于微信开发者工具连接局域网 NAS。`nasProduction.apiBaseUrl` 预填候选 origin `https://api.muwei.xyz`，但当前公网入口和可信证书尚未就绪，不能启用；切换仍要求显式修改 `activeProfile`。代码没有改变 `project.config.json` 的 `urlCheck: true`。

生产 NAS origin 只接受 ASCII DNS hostname 加可选合法端口的裸 `https://` origin；不接受尾部斜线、路径、查询、片段、用户名/密码或空白。候选域名尚未具备受信任的完整 HTTPS 链和可用路由，所以该配置只用于后续接通准备。若 Pangolin SSO 保护此 API origin，小程序的 `wx.request` 无法完成浏览器交互式 SSO；上线前必须有与 NAS 的微信 code 换短时 token 流程兼容的入口，不能在客户端加入 Basic 凭据或静态密钥绕过 SSO。

局域网 profile 使用 `http://192.168.50.28:18118`，只适合连接同一局域网的开发者工具。开发者工具可能需要在本机项目设置中关闭合法域名校验；不要把这个设置写进共享项目配置。真机和体验版必须使用有效 HTTPS 公网域名，并通过微信服务器域名校验。

## NAS HTTP 契约

业务调用均为 `POST /v1/action`，请求层保留 `api/transport.js` 的 action/payload 映射：

```http
POST /v1/action
Authorization: Bearer <short-lived token>
Content-Type: application/json
```

```json
{"action":"posts/list","payload":{"cursor":"..."}}
```

服务端响应使用 `{ code, message, data, requestId }`。成功时 service 只收到 `data`；HTTP 状态码和业务 `code` 映射为统一的 `ApiError`。`401` 或 `membership_invalid` 会清除内存 token 和账号作用域缓存、切换访客态；下一次请求会重新走微信登录，不自动重放刚失败的业务写入。写操作沿用已有 `idempotencyKey`。

## 微信身份

NAS profile 首次请求用 `wx.login` 取得一次性 `code`，向 `POST /v1/auth/wechat` 交换短时 token，再以 `Authorization: Bearer` 调业务 action。token 只存在 JavaScript 内存中，冷启动重新获取。客户端不提交 OpenID、角色或成员状态；NAS 服务端负责调用微信 code-session 接口并根据自己的数据库建立身份和权限。微信 AppSecret 只保存在 NAS 服务端。

当前小程序没有独立的显式退出登录 API；`clearAccountScope()` 会清掉本地账号作用域和内存 token。若业务需要立即撤销服务端 token，后端还需提供并联调 logout/revoke 契约。

## 图片

现有上传流程把压缩后的 JPEG/PNG 转为 base64，经 `assets/upload` action 顺序发送；原图上限为 2 MiB，JSON/Base64 请求体会大于原图，NAS API 与反向代理必须允许对应请求体并覆盖当前 30 秒上传超时。上传意图、确认、状态轮询和幂等重试保持原契约。

详情接口返回短时图片 URL。预览时前端重新请求详情以续签，再由 `wx.previewImage` 读取远端图片。因此受限图片 URL 必须经过后端权限检查并短时签名；签名 URL 的实际 host 必须列入公众平台 `downloadFile` 合法域名。API host 的 `request` 白名单不自动覆盖图片 host；若签名 URL 使用独立媒体域名，必须登记那个实际媒体 host。NAS 的图片 URL 仍需现场核对 host 和重定向目标。若未来改成 `wx.uploadFile`，还需单独登记 `uploadFile` 合法域名；当前代码没有使用它。

## 网络配置与上线门

体验版/真机切换到 NAS 前，必须完成以下配置并逐项验收：

- 将 API 的 HTTPS host 加入小程序 `request` 合法域名；把签名图片 URL 的实际 host 加入 `downloadFile` 合法域名。两类白名单彼此独立，登记的是 host，不含路径；保持 `urlCheck: true`。
- HTTPS 证书有效且完整、域名直接可达；API 和图片响应不能重定向到未登记域名。NAS 本地 HTTP 地址不能用于真机或体验版。
- NAS 出站调用微信登录 code-session 接口可用；AppSecret 不进入小程序、请求日志或错误响应。服务端拒绝客户端自报的 OpenID、角色和成员状态。
- 真实验收覆盖访客、有效成员、被移除成员、管理员、过期/撤销 token；检查登录、普通 action、图片签名下载、2 MiB 图片上传与审核、弱网/超时幂等、API 重启和 fail-closed。

代码 profile、开发者工具请求成功或 HTTP health check 都不等于体验版/真机验收。当前默认仍为 CloudBase；外网 HTTPS 入口和公众平台域名白名单完成后，才填写 `nasProduction.apiBaseUrl` 并显式切换 profile。
