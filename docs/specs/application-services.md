# application-services：应用和作用域

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/application.ts、services.ts；提供新 application 子入口，不改变旧 mountGame/bootstrapGame。

实现进度：T11/T12 已提供 defineService/provideService、类型化工厂上下文、服务/Store 装配及 defineApplication/mountApplication/bootstrapApplication。T15 已接入路由、默认导航与退出回收，T18 已接入资源 owner 装配；T19 已接主题配置/根 CSS token/契约解析及资源 lease/回退；宿主页面生命周期仍待对应任务装配。

## 应用配置

```ts
const application = defineApplication({
  root: AppShell,
  routes,
  providers: [],
  theme: defaultTheme,
  router: { mode: 'hash' },
  onError(error) {
    console.error(error);
  },
});
const app = await mountApplication(container, application);
// 或 bootstrapApplication(application)，按 root.selector 找唯一宿主。
```

T12 配置接入 root、providers、inputs 与 onError。T15 接入可选 routes 和 router：默认 `{mode:'hash'}`，history 模式支持 base；测试/多应用可用 `{history: () => createMemoryHistoryDriver('/')}` 为每次挂载提供独立驱动，工厂模式不与 mode/base 混用。router 配置必须同时有 routes。根组件挂载前安装路由上下文，唯一 RouterOutlet 就绪后对当前地址执行初始 replace；mount/bootstrap 仅在导航 committed/redirected 后完成，初始拒绝、取消或失败会拒绝并回收实例/驱动/宿主。

返回 root、只读 state（running/disposed）、dispose，以及按 routes const 名称/参数保留类型的 router；未配置 routes 时 router 为 undefined。bootstrapApplication 的可选第二参数为 `{document}`，浏览器驱动使用宿主文档的 defaultView，不自动启动浏览器。定义对象可共享，history 工厂应每次返回新驱动。退出先停止 Router，再释放根与服务，失败聚合且继续清理；theme 需 defineTheme/extendTheme 的有效定义；已接入 root CSS 变量、useTheme(contract) 解析与资源 lease/回退；宿主 pagehide/往返缓存仍待对应任务。

可选 `router.idle: {targets: [...], scheduler?}` 在初始导航成功后启用有限队列；targets 是显式应用内目标，名称/参数继承 routes 类型，不扫描所有路由。每次调度只处理一个目标，完成后再调度下一个，不循环重试。每个目标仍需叶记录 preload:'idle' 且整条链不受保护。默认使用宿主可取消的 requestIdleCallback，不可用时回退到下一计时任务；这不代表测量证明的空闲帧。`IdleScheduler.schedule(callback)` 必须延后执行并返回取消函数，可注入手动调度器测试。目标配置在 define 时拍快照；应用退出取消排队回调，已开始 import 不强制中断但不会继续排队。

可选 assets 配置见 asset-loading：同步 transport 工厂与并发上限，每次挂载独立缓存；根/页面上下文取得的 assets 绑定当前 owner，app.assets 绑定应用 owner，未配置为 undefined。启动失败与退出清理涵盖资源管理器，异步释放错误经 onError 报告；真实图片/音频适配器由业务注入。

配置是共享描述；每次挂载创建独立服务、Store、Router、主题和根组件。重复挂载同一宿主报错；启动失败清理已创建的实例，宿主可再次使用。应用对象至少暴露 router、只读运行状态、dispose；不默认把 Engine 暴露给每个组件。

Scope 分为应用、页面、组件。子级继承父级服务，可显式覆盖；工厂只在首次取用时创建，dispose 反向清理。服务通过类型化定义/标识引用，不能用任意字符串查找后强制断言。循环获取、未提供服务、已销毁 owner 获取必须有含来源的诊断。

`defineService({name, factory(context)})` 创建类型化定义，`provideService(Service, overrideFactory?)` 登记到应用或页面 providers；context.useService(Service) 按定义身份解析。工厂 context 提供 scope/signal/其他服务获取，own 登记清理；name 仅用于诊断，相同显示名不表示同一服务。页面 providers 在创建页面作用域时登记，不在每个子组件重复创建。

工厂同步创建服务对象，异步 I/O 放在服务方法中；工厂不能直接返回 Promise。相同 owner 重复登记同一定义时报错，父子 owner 则可显式覆盖。服务工厂的依赖从提供者 owner 解析，因此应用级单例不会因调用它的页面而意外取得页面私有服务。

服务与 Store 的资源 owner 在成功创建后登记到提供者 Scope，候选失败由当前构造负责清理。提供者退出时先释放其子组件/页面，再按成功创建的逆序释放资源，保证依赖方先于被依赖方退出。清理失败带定义名称和操作来源，其他资源仍继续释放。

组件 context.useService/useStore 从其 owner 解析。页面为路由挂载对象，继承应用作用域；缓存页面显式保留页面作用域。异步 continuation 捕获自己的 owner，不依赖全局“当前组件”变量。

## 异常和退出

ApplicationError 携带 module、source、operation、cause；生命周期错误沿用可定位语义。组件/页面启动失败回滚候选；销毁失败聚合原因并继续清理。onError 是观测入口，不把失败自动改为成功；onError 自身同步抛错或异步拒绝时，与原错误聚合后只报告给宿主，不递归调用自身。启动/退出失败仍向调用者抛出/拒绝，即使已通知 onError；没有错误观察器时不为同一可捕获的启动失败额外制造宿主异常。

应用退出释放 Router 事件、根组件、服务、Store、资源持有及页面内游戏。正常 pagehide 可销毁；往返缓存暂停可暂停的活动并在恢复时保留手动暂停状态。默认行为由注入宿主驱动测试，不能强依赖全局 window。

## 直接验收

A1：两个应用服务/Store 隔离；层级覆盖正确，父应用释放所有子 owner。

A2：初始化/组件挂载/服务工厂失败后完整回收，重复 dispose 安全，重新挂载可行。

A3：丢失/循环服务与错误处理器自身故障有直接诊断，不留下运行活动。

测试：tests/application-runtime.test.ts、tests/services.test.ts；使用 Node DOM/注入驱动。


router.guards 的同步应用工厂提供服务 scope/signal/own/useService 与类型化 resolve，每次挂载独立创建通用守卫数组；工厂异常清理已创建 Router/历史驱动和作用域资源。全局守卫在离开守卫后、各记录守卫及页面加载/prepare 前运行；路由不反向依赖账号模块。配置全局守卫时自动 intent/idle 预加载保守跳过，不运行有副作用的守卫。可选认证装配与完成边界见 access-policy 规格。
