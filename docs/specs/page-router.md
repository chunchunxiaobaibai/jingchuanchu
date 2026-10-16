# page-router：导航、懒加载和预加载

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/router/{types,matcher,loader,router,history}.ts。router 接受通用守卫，不导入具体 auth 模块。

## 公共形状

```ts
const routes = defineRoutes([
  { name: 'home', path: '/', page: HomePage },
  {
    name: 'play',
    path: '/play/:levelId',
    loadPage: () => import('../pages/play/play-page.js').then((m) => m.PlayPage),
    preload: 'intent',
    children: [],
    prepare: async (context) => ({ levelId: context.params.levelId }),
  },
]);
await context.router.push({ name: 'play', params: { levelId: 'one' } });
await context.router.preload({ name: 'play', params: { levelId: 'one' } });
```

路由定义支持 name、path、page/loadPage（二选一）、children、redirect、guards、beforeLeave、prepare、preload、meta。name 应唯一；相同匹配模式冲突要诊断。支持静态段、:param、末尾 *catchAll；静态优先，参数安全解码，无匹配走显式 fallback。首阶段不实现任意正则路由语法。

RouteTarget 是合法应用内 path 或带 name/params/query/hash 的目标。配置为 const 时名称/所需参数可类型推导，动态路径仍运行校验；拒绝外部 scheme。Router 提供 push、replace、back、preload 及只读 current/pending/error；导航返回 committed/cancelled/denied/redirected/failed 的结构化结果。

root/layout 用 `<router-outlet>` 承载子页面，嵌套路由保留未改变的父布局；页面通过 context.route 读取只读参数/查询。prepare 的返回值作为目标页面输入，需经输入定义验证；不赋值给别的页面实例。

## 导航提交

流程：解析目标 → 离开确认 → 守卫 → 模块加载 → 页面准备 → 候选创建 → 原子切换活动页与 URL。GuardResult 明确为 allow、deny(reason) 或 redirect(target)，禁止先导航后跳回来。首个重定向结束当前守卫链，检测重定向循环。

新导航使旧导航失效，取消准备信号并释放候选。目标准备失败保留原页；页面创建后旧页清理失败报告错误但新页保持已提交，不假装旧页仍可恢复。相同模块不同参数重新运行策略和准备；是否复用页面实例在路由上显式设置，默认不缓存实例。

默认 hash 模式；history 模式要求宿主有页面回退配置。注入 HistoryDriver 负责 URL/前进后退，用户历史导航也经过相同守卫；拒绝 pop 导航需恢复已提交的地址/位置。不要拿 Node 模拟证明所有浏览器历史行为已验收。

## 加载策略

preload 为 none（默认）、intent 或 idle。路由链接用 route-link 组件/指令解析目标，intent 由聚焦/指针意图触发；idle 仅处理配置的有限目标，业务也可调用 preload。懒加载与预加载共享进行中的 Promise、成功模块缓存；失败不永久缓存失败 Promise。

preload 不改变 URL、不调用 prepare、不创建 Store/页面/Canvas/网络活动。import 会求值模块顶层，因此定义模块顶层禁止自启动。动态 import 不能保证强制中断，但失效导航不可提交其结果；模块缓存与页面缓存、用户数据和图片缓存分别处理。

受保护目标默认不自动预取；实际导航始终重验策略。代码可被公开下载不构成授权。根布局可展示加载/重试反馈；旧部署 chunk 失败由明确的失败结果提示重试/刷新，不自动无限刷新。

## 直接验收

P1：参数、查询、嵌套出口、重定向、404、push/replace/back 和拒绝历史导航可在注入驱动下验证。

P2：懒加载只调用一次成功 loader；preload 与导航去重，不执行页面准备/游戏活动。

P3：守卫拒绝、快速切换取消、失败回滚、旧页清理失败后的提交状态正确。

P4：Vite 静态构建产物确实将游戏页分块；入口没有静态导入所有页面。

测试：tests/router.test.ts、tests/router-loading.test.ts，构建拆块用 tooling fixture。手工浏览器历史/首屏网络观察在授权后单独验收。
