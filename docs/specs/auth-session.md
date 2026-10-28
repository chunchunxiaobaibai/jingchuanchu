# auth-session：可选账号会话适配

公共规则及服务端边界见 [SPEC](../../SPEC.md)。位置：runtime/auth.ts；依赖应用服务和 Store，不依赖 Router。

实现进度：T29 已提供公开 AuthService，复用应用服务的可选 Provider 工厂；会话恢复、登录/登出、身份清理与两个应用隔离已做 Node 定向验证。T31 已提供注入测试后端/HTTP 客户端示例，不代表外部后端或真实浏览器认证已验收。

## 恢复核心

AuthProvider 的 restore/login 返回未知请求结果，由同一同步 decode 转为 anonymous 或 authenticated(user)；User 至少有非空 id，只放普通数据展示 DTO。框架保存经过 decode 的只读身份，不把原始响应放入 session；凭据由请求层持有。restore/login/logout 都接 CancellationSignal。

内部 createAuthRestorer 默认 unknown，ensureSession 才调用 restore，进行中的恢复共享 Promise；成功的匿名/身份缓存，失败保留 failed 并允许下一次显式请求重试。decoder 或请求失败返回带 operation/cause 的 AuthError，不能把失败当匿名或已认证。invalidate/退出先递增代次并清掉本地身份，再取消旧恢复；忽略取消的晚到结果不解码、不提交。退出后 ensureSession 返回 cancelled。内部 createAuthRestorer 不从 application 导出；使用公开 AuthService 访问同一会话核心。

内部 registerCleanup(callback,scope?) 注册用户 Store 重置、页面/网络取消等同步清理，返回注销函数；传入 scope 退出后自动注销。失效/退出先清身份和代次，再尝试全部仍有效登记；某个清理失败不阻止其他回调，错误聚合保留 cause。清理期间不新建恢复请求，异步 cleanup 被拒绝并消费其 Promise 拒绝。恢复等待先登记再调用 Provider，Provider 同步触发失效时也能结算 cancelled，后续请求不受旧等待污染。

## 登录与登出

内部 login(input) 先失效旧代次、清本地身份并执行登记清理，再调用 Provider.login；清理失败阻止新登录，也不能通过 ensureSession 绕过未完成的清理。并发登录以最新请求为准，旧请求立即 cancelled，忽略取消的结果不提交。登录等待期间 session=restoring，只有 decode 确认身份后才能 authenticated；输入不写入 session。

logout() 立即清身份与敏感活动，session=anonymous，再等待 Provider.logout 撤销。ensureSession 在撤销等待期间直接返回匿名，不重新恢复旧会话。结果为 logged-out(remoteRevocation:confirmed)、failed(localCleared:true,remoteRevocation:confirmed|unconfirmed,error) 或 cancelled；confirmed 只表示 Provider 的撤销调用成功确认，unconfirmed 不声称服务器已经撤销。清理错误仍尝试远端撤销并分别报告；远端失败不恢复本地身份。晚到旧登出不能清掉后续已确认的新登录。

测试仅注入 Provider，不能据此宣称真实后端认证或撤销已经通过。

## 可选应用装配

从 `@xiaobaibaifqy/jingchuanchu-app/application` 导入 AuthService、defineService、provideService。业务通过已有服务机制注册，无需新的全局会话配置：

```ts
const Account = defineService({
  name: 'account',
  factory(context) {
    return new AuthService({
      scope: context.scope,
      provider: createAccountProvider(), // 业务实现 AuthProvider<LoginInput, User>
    });
  },
});

const Root = defineComponent({
  selector: 'app-shell',
  $template: '<main>Game</main>',
  setup(context) {
    const auth = context.useService(Account);
    const game = context.useStore(UserGameStore);
    auth.registerCleanup(() => game.reset(), context.scope);
    return { auth, game };
  },
});

const application = defineApplication({
  root: Root,
  providers: [provideService(Account)],
});
```

createAccountProvider、UserGameStore 是业务接入点，后端实现见 T31。Provider 工厂在首次 useService 时按应用实例创建；构造 AuthService 不发请求，必须显式调用 ensureSession 或 login。组件/场景/Store 使用同一个 Account 定义取得应用共享服务；复用同一应用定义挂载两次仍产生独立会话与 Provider。单机项目省略此服务，未消费的 Provider 不构造、不请求。

userScoped 标记不会自动绑定某个账号服务，业务显式登记需要重置的 Store 与页面/网络资源。登记 scope 应覆盖敏感活动的完整生命周期；上例根组件登记随应用存在，临时页面登记随页面退出注销。Store.reset 同时使用已有任务代次取消旧业务提交。应用退出由服务 scope 释放会话并取消等待，不因 Provider 忽略取消而复活身份。

## 契约

AuthProvider<LoginInput, User> 定义 restore(signal)、login(input,signal)、logout(signal)，返回经业务 decoder 校验的匿名/已认证结果。User 只包含展示所需身份、权限声明等最小信息，凭据交给 Provider 的请求层管理。

AuthService 提供 ensureSession、login、logout 和只读 session 状态。状态为 unknown/restoring/anonymous/authenticated/failed；并发恢复共享请求。只有 Provider 确认后才进入 authenticated，不把未知或网络失败当成功。

服务按应用实例隔离；单机应用不提供服务，不生成登录目录。示例 Provider 必须有明确后端配置和真实请求协议，不以本地 loggedIn=true 作为认证实现，也不要求框架自带账号数据库。

会话失效/切换账号递增身份代次，取消旧请求并触发已登记的 user-scoped Store 重置与页面/网络清理；旧 Promise 结果不得恢复旧身份。登出失败也立即清理本地敏感活动，同时报告服务端撤销失败，不能假称远端会话已撤销。

Cookie/令牌策略由部署适配确定。默认示例使用同源服务器会话，由后端设置安全 Cookie 并处理所需 CSRF；不在普通 Store、URL、日志或默认持久化保存凭据。具体后端地址属于业务配置，不硬编码服务商。

## 直接验收

I1：恢复去重及 unknown/anonymous/failed 区分，Provider 输出校验，单机无认证依赖。

I2：账号切换后旧请求不能写回，用户 Store 和资源清理被调用；两个应用隔离。

I3：带假后端的接入示例区分有效/过期会话及撤销失败，不只演示前端标记。

测试：tests/auth-session.test.ts，注入 Provider/请求驱动。真实后端接入由项目明确提供，不能在规格阶段宣称已完成外部身份认证。


T31 自动项完成：examples/auth-adapter 提供同源 HTTP AuthProvider、响应白名单 decoder、明确端点协议与 Request/Response 内存测试后端。注入 Cookie jar 集成验证会话/token 轮换、过期恢复匿名、无权限/无身份仍拒绝直接 reward 请求、CSRF/Origin 拒绝及撤销失败仍保持远端会话可用；异步 verifier 不复活过期会话。测试未监听端口，不代表外部后端或真实浏览器的 Cookie 策略通过，部署接入与边界见该目录 README。
