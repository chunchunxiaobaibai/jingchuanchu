# access-policy：权限策略与路由集成

公共边界见 [SPEC](../../SPEC.md)。位置：runtime/access.ts；依赖 auth-session。由 app-config 把策略接入 Router 的通用守卫，Router 不反向导入账号代码。

## 权限模型

业务定义有限权限键，角色可映射到权限；AccessService.can 返回展示用判断，check/守卫可等待会话并返回 allow、deny(reason)、redirect(target)。支持 all/any，若同时指定则两组都满足。未知键、缺失策略或未确认身份不允许受保护操作。

资源归属等策略可使用服务器返回结果，不由本地角色字符串推断所有资源的真实权限。公共组件使用 allowed/disabled 输入或公开能力，不强依赖某个账号 Store。

## 路由策略

认证应用路由在 meta.access 中显式声明 public 或 {session:'required',all/any}，由 app 装配的权限守卫读取。Router 的通用 meta 不导入 AuthService。父子条件累计，子 public 不解除父限制。守卫在页面准备/Canvas 活动之前执行；直接 URL、链接、程序导航及前进后退使用同一规则。

未知身份等待 ensureSession；匿名进入业务登录流程；已认证但无权限进入 forbidden 结果。登录返回目标限合法应用内 RouteTarget，避免外部重定向和循环。401 会话失效与 403 无权限分别处理，不把所有错误都当成重新登录。

会话被撤销后重新检查当前受保护页面，并停止其用户活动；已下载页面代码或已挂载页面都不是继续访问的依据。纯单机模式不要求每条路由声明账号策略。

真正的 HTTP/WebSocket 操作必须由服务端验证身份及资源权限。示例同时包含客户端拒绝体验和服务端拒绝结果；浏览器 Store 或按钮被篡改不能改变后端结果。

## 直接验收

Q1：匿名/恢复中/无权限产生不同导航结果，拒绝时不创建页面准备或 Canvas。

Q2：嵌套策略累计、权限变更驱逐、内部返回目标及授权前后导航都可验证。

Q3：假后端仍拒绝绕过前端守卫的请求/消息，不能以隐藏按钮代替测试。

测试：tests/access-policy.test.ts、Router 集成 fixture；实际业务权限规则由业务项目提供。
