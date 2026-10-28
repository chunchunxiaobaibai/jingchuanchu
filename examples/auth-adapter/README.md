# 可选同源账号适配示例

当前进度：已提供协议 decoder、HTTP AuthProvider 和内存测试后端，客户端→后端 Request/Response 注入集成通过，覆盖有效/过期会话、撤销失败和绕过客户端仍拒绝。测试后端通过 handle(request) 运行，不自动监听端口；这些检查不代表真实网络/浏览器部署已验收。此示例不加入默认单机模板，也不依赖外部账号服务商。

`protocol.ts` 定义 LoginInput、展示 User 和有限 Permission；`client.ts` 提供 createHttpAuthProvider，按应用实例创建，不使用全局会话。具体 API URL 由业务注入，要求与 applicationOrigin 同源，不包含 URL 凭据/query/hash。构造不发请求，浏览器使用 Cookie 和 credentials:same-origin；客户端不读 HttpOnly Cookie，也不把会话凭据放入 Store、URL 或持久化。

```ts
const Account = defineService({
  name: 'account',
  factory(context) {
    const origin = window.location.origin;
    return new AuthService({
      scope: context.scope,
      provider: createHttpAuthProvider({
        applicationOrigin: origin,
        baseURL: new URL('/api/auth', origin).href,
      }),
    });
  },
});
```

defineService/AuthService/provideService 从引擎 application 子入口导入；应用配置 providers:[provideService(Account)]。页面/根组件使用 context.useService(Account)。路由权限另按 [access-policy](../../docs/specs/access-policy.md) 配套 createAccessGuard、bindAccessRouter。业务用户名/密码只作为 login 请求输入，不进入 AuthService.session；decodeSession 显式选择 id/displayName/permissions，原始响应中的 token/password 等字段不转交会话。

## 服务端协议

baseURL 下端点如下；响应均不缓存，状态码不能以任意 2xx 替代。

| 端点 | 请求 | 成功/匿名响应 |
| --- | --- | --- |
| GET session | 无正文 | 200 `{user,csrfToken}`；缺失/过期会话为 401 `{user:null,csrfToken}` |
| POST login | JSON `{username,password}`、X-CSRF-Token | 200 `{user,csrfToken}`，user 必须非空；无效凭据 401 |
| POST logout | JSON `{}`、X-CSRF-Token | 确认撤销成功 204；撤销失败非 204 |
| POST reward | JSON `{}`、X-CSRF-Token | 200 `{reward:number}`；无身份 401、无 claim-reward 权限 403 |

User 至少包含非空 id、displayName 字符串和只由 play/claim-reward 组成的权限数组。session 的 401 必须仍是可校验匿名 envelope，附新匿名会话的 CSRF token；401 携带已认证身份是协议错误。其他错误/无效响应返回失败，不当作登录成功或匿名。

服务端部署契约：同源 HTTPS，服务端设置 Secure/HttpOnly/SameSite Cookie；session 为登录前 CSRF 建立匿名会话，登录确认后轮换会话与 token；所有写端点检查 Origin、Cookie 会话与 X-CSRF-Token。CSRF token 只在 Provider 闭包持有，不作为用户展示字段。当前客户端不设置浏览器禁止的 Cookie/Origin 请求头，不用 JS 保存服务器会话 Cookie。测试注入传输，后端自持内存会话表并调用业务提供的 authenticate，不要求引擎内置账号数据库。

Provider 的 claimReward 是独立业务请求示例，不通过隐藏按钮授予权限。HttpAuthError 保留 status/operation；业务收到受保护请求的 401 时调用 auth.invalidate 并进入登录流程，403 展示无权限，不能把所有错误都当成重新登录。默认不自动重试写请求。logout 非 204 交给 AuthService 报告 localCleared:true/remoteRevocation:unconfirmed，不能据本地匿名声称服务器已撤销。

CancellationSignal 桥接 AbortController，订阅覆盖读取响应体的阶段；即使注入传输忽略 abort，晚到响应在更新 CSRF/返回数据前仍检查取消。API redirect:error，不跟随重定向迁移凭据。测试不证明真实浏览器的 Cookie/CSRF 策略或目标部署已生效。

## 注入测试后端

server.ts 的 createExampleAuthBackend({origin,basePath,authenticate,now?,ttlMs?,beforeRevoke?}) 返回 handle(Request) 与 dispose。origin 显式要求 HTTPS，Cookie 固定为 __Host-jcc-auth-example，Secure/HttpOnly/Path=/；同源写请求校验 Origin、JSON Content-Type、Cookie 和常量时间比较的 CSRF token。GET session 对无身份/过期会话建立匿名 CSRF 会话；登录成功删除旧会话、创建随机新会话/token。User 从 verifier 结果白名单选择并复制冻结，权限判断读取服务器会话，不读取请求正文中伪造的用户或权限。reward 只需 claim-reward；真实资源归属规则由业务扩展。

```ts
const backend = createExampleAuthBackend({
  origin: applicationOrigin,
  basePath: '/api/auth',
  authenticate: verifyBusinessCredentials,
});
const response = await backend.handle(request);
// 退出测试或释放宿主时：backend.dispose()
```

verifyBusinessCredentials 是业务注入的凭据校验函数，返回最小 User 或 null；本目录没有预置账号数据库/固定生产账号。now/ttlMs 用于确定性过期测试；beforeRevoke 可注入撤销故障，失败返回 503 且不删除会话，成功 204 删除服务器会话并过期 Cookie。异步 verifier 返回后重新检查会话/请求取消，旧会话已经过期或撤销时拒绝创建新身份。dispose 清空内存会话。

测试 Cookie jar 只在 Node 测试传输中读取 Set-Cookie、发送 Cookie/Origin，不导出为浏览器客户端功能。测试分别跳过 can/路由守卫直接请求 reward，并提交伪造权限；服务端仍返回 401 或 403。撤销失败时特意确认原 Cookie 仍可请求 reward，证明本地匿名不等于远端已撤销；撤销成功后重放旧 Cookie 被拒绝。

## 当前检查

仓库根目录运行 `tsx --conditions=source --test tests/auth-adapter.test.ts tests/auth-backend.test.ts`，并执行 `tsc --noEmit`。当前 Windows 依赖环境使用 node.exe 执行对应 tsx/tsc 入口，见 tasks/todo.md 的实际命令。客户端测试注入 Response，后端集成注入实际 Request/Response、Cookie jar 和验证器；没有打开浏览器、监听网络端口或请求外部服务。部署时需把 handler 接入业务 HTTPS 宿主，并以目标浏览器验证 Cookie/CSRF 行为。
