# application-services：应用和作用域

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/application.ts、services.ts；提供新 application 子入口，不改变旧 mountGame/bootstrapGame。

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

配置是共享描述；每次挂载创建独立服务、Store、Router、主题和根组件。重复挂载同一宿主报错；启动失败清理已创建的实例，宿主可再次使用。应用对象至少暴露 router、只读运行状态、dispose；不默认把 Engine 暴露给每个组件。

Scope 分为应用、页面、组件。子级继承父级服务，可显式覆盖；工厂只在首次取用时创建，dispose 反向清理。服务通过类型化定义/标识引用，不能用任意字符串查找后强制断言。循环获取、未提供服务、已销毁 owner 获取必须有含来源的诊断。

`defineService({name, factory(context)})` 创建类型化定义，`provideService(Service, overrideFactory?)` 登记到应用或页面 providers；context.useService(Service) 按定义身份解析。工厂 context 提供 scope/signal/其他服务获取，own 登记清理；name 仅用于诊断，相同显示名不表示同一服务。页面 providers 在创建页面作用域时登记，不在每个子组件重复创建。

组件 context.useService/useStore 从其 owner 解析。页面为路由挂载对象，继承应用作用域；缓存页面显式保留页面作用域。异步 continuation 捕获自己的 owner，不依赖全局“当前组件”变量。

## 异常和退出

ApplicationError 携带 module、source、operation、cause；生命周期错误沿用可定位语义。组件/页面启动失败回滚候选；销毁失败聚合原因并继续清理。onError 是观测入口，不把失败自动改为成功；onError 自身失败不能递归回调自己。

应用退出释放 Router 事件、根组件、服务、Store、资源持有及页面内游戏。正常 pagehide 可销毁；往返缓存暂停可暂停的活动并在恢复时保留手动暂停状态。默认行为由注入宿主驱动测试，不能强依赖全局 window。

## 直接验收

A1：两个应用服务/Store 隔离；层级覆盖正确，父应用释放所有子 owner。

A2：初始化/组件挂载/服务工厂失败后完整回收，重复 dispose 安全，重新挂载可行。

A3：丢失/循环服务与错误处理器自身故障有直接诊断，不留下运行活动。

测试：tests/application-runtime.test.ts、tests/services.test.ts；使用 Node DOM/注入驱动。
