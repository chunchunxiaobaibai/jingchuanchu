# application 公开 API 索引

下列 API 均从 `@xiaobaibaifqy/jingchuanchu-app/application` 导入，适用于当前源码配套包。签名按用途简写，泛型和完整选项以包自带声明为准；实现入口为 packages/app/application.ts。普通消费默认 ESM/.d.ts，不配置 source 条件。旧根入口见 [旧手册](application-suite.md)，基础引擎见 [底层 API](api-reference.md)。

## 响应式与组件

| API                            | 参数 / 返回                                                                           | 使用要点                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `signal<T>`                    | `initial → WritableSignal<T>`                                                         | read() 深只读快照；set(value)/update(reducer) 替换                     |
| `computed<T>`                  | `derive → ReadSignal<T>`                                                              | 惰性缓存、动态依赖；不得异步或写依赖                                   |
| `effect`                       | `(run, scope, {onError?}?) → Cleanup`                                                 | 微任务运行；run(onCleanup) 同步，退出停止                              |
| `batch`                        | `callback → 回调返回值`                                                               | 立即写、合并通知，不回滚                                               |
| `nextTick`                     | `() → Promise<void>`                                                                  | 等视图批次，不等 I/O 或游戏帧                                          |
| `input<T>`                     | `{required:true} 或 {default:值/工厂} → InputDefinition`                              | 默认 value 快照；mode:'reference' 保留显式能力身份                     |
| `output<T>`                    | `() → OutputDefinition<T>`                                                            | 由 context.emit(name,payload) 发出；无类型参数为 void                  |
| `model<T>`                     | `required/default → ModelDefinition`                                                  | 子组件可写、父目标须可写                                               |
| `writableModel<T>`             | `{get,set,convert?,event?} → WritableModel`                                           | convert:string/number/boolean/strings；event 默认 input，可改 change   |
| `defineComponent / definePage` | `options → ComponentDefinition / PageDefinition`                                      | selector、inputs/outputs/models、components、setup、生命周期、资源路径 |
| `mountComponent`               | `(host, definition, {inputs?,models?,outputs?,owner?,onError?}?) → ComponentInstance` | 低层挂载；定义须经 tooling 编译                                        |

WritableModel 额外有 draft()/validation()/resetDraft()，validation 区分 valid、empty-number、invalid-number。模板 model:value 用文本/数值/多选，model:checked 用布尔；数值与多选使用显式转换。程序写回不产生用户事件；动态 select 在选项变更后重新同步。

ComponentInstance 提供 exposed、owner、setInputs(patch)、activate/deactivate/dispose；绑定到父目标的 model 应通过父目标更新。普通业务优先用 mountApplication/bootstrapApplication 获取配置完整的上下文，不手工创建内部 owner。

ComponentContext 可用 inputs/models、scope/signal、own、emit、element(ref)、on(ref,event,listener)、useStore、useService，以及已配置的 router/route/assets/audio/useTheme。缺少对应能力时访问会报错，context.audio/assets 不是自动安装的浏览器适配器。

生命周期：setup → onInit → 子 onMount → 父 onMount；输入变化调用 onInputsChanged(previous/current)，DOM 变化调用 onBeforeUpdate/onUpdated，显式停用/恢复调用 onDeactivate/onActivate，退出 onDestroy 与 Scope 清理。所有钩子同步；context.exposed 在 setup 之后可用。当前 setup 写在依赖其推断的钩子前。

示例：[组件与页面教程](application-components.md)。契约：[响应式](../specs/reactive-core.md)、[组件](../specs/component-model.md)。

## Store、Service 与应用

| API                    | 参数 / 返回                                                | 使用要点                                                                     |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `defineStore`          | `{name,userScoped?,setup} → StoreDefinition`               | setup 返回 state/getters/actions；state 用可写 signal，getters 用只读 signal |
| `defineService`        | `{name,factory} → ServiceDefinition<T>`                    | 同步工厂，异步业务放服务方法                                                 |
| `provideService`       | `(definition, overrideFactory?) → ServiceProvider`         | 放入 defineApplication.providers，重复注册报错                               |
| `defineApplication`    | `options → ApplicationDefinition`                          | root 必需；providers/assets/audio/theme/routes/router/inputs/onError 可选    |
| `mountApplication`     | `(host, definition) → Promise<ApplicationInstance>`        | 初始化与首路由提交后返回，失败回收已创建资源                                 |
| `bootstrapApplication` | `(definition,{document?}?) → Promise<ApplicationInstance>` | 文档中必须恰有一个根 selector 宿主                                           |

Store 按应用懒创建并共享，不同挂载隔离；对外 state/getters 为只读 readers，actions 保留参数/返回类型。StoreInstance.reset 保留实例身份、重置初始 state、取消旧任务；dispose 结束实例。userScoped 默认 false，是业务账号隔离标记，须与账号清理显式装配，不会自动迁移存档。

StoreContext.runTask(run,{key?}?) 返回 completed(value)/cancelled。同 key 请求替换；reset/dispose 取消；任务必须通过 task.commit(() => 同步写入) 提交。task.signal 是引擎 CancellationSignal。onReset/own 可登记清理，useStore/useService 解析依赖；循环依赖会报错。

ApplicationInstance 提供 root、router（无 routes 时 undefined）、assets/audio（未配置时 undefined）、useTheme、state()（running/disposed）和 dispose。dispose 幂等，手工清理错误聚合后抛出。根 inputs 当前按数据快照，不接受带函数的引用定义；场景/驱动在根 setup 暴露。onError 收到 ApplicationError 的 module/source/operation/cause，异步观察器错误交宿主报告。

## 路由与预加载

| API                          | 参数 / 返回                                           | 默认与约束                                                                |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `defineRoutes`               | `route[] → 保留字面量的路由数组`                      | page/loadPage/redirect 三选一；name 唯一、模式冲突拒绝                    |
| `createRouteMatcher`         | `routes → match(path)/resolve(target)`                | 根绝对路径、子相对路径，:param/*catch；参数独立编码                       |
| `createRouter`               | `{routes,history,renderer,guards?,onError?} → Router` | 低层入口，需显式提供 HistoryDriver/RouteRenderer                          |
| `createMemoryHistoryDriver`  | `initialPath? → HistoryDriver`                        | 默认 /，Node 测试可用                                                     |
| `createBrowserHistoryDriver` | `{window?,mode?,base?,onError?}? → HistoryDriver`     | 默认 hash；base 仅用于 history；每 window 单一 owner                      |
| `RouterOutlet`               | `内置组件`                                            | 在根/布局 components 中显式注册，模板 router-outlet                       |
| `RouteLink`                  | `内置组件`                                            | to 必需，replace=false、target='_self'、download=null；navigated 输出结果 |

RouteDefinition 关键字段：path、name?、children?、guards?、beforeLeave?、prepare?、preload?、meta?。prepare 返回页面 inputs；loadPage 返回 definePage 定义。RouteLocation 有 path/fullPath/params/query/hash/matched/meta。GuardResult 为 allow、deny(reason?)、redirect(target)。导航按离开守卫、全局守卫、目标链守卫、加载、prepare、提交处理。

Router.current/pending/error 为只读 signal；resolve/href 生成位置/链接，push/replace/back 返回 Promise<NavigationResult>，invalidate 取消导航并释放当前视图，dispose 释放驱动和视图。NavigationResult 为 committed/redirected/cancelled/denied/failed；同名导航也可能重建叶页面，不等同缓存实例。

preload(target,{trigger?}?) 返回 loaded/skipped/cancelled/failed，不运行守卫、prepare 或页面。自动 intent/idle 需要路由 preload:'intent'/'idle'，受保护链跳过；idle 还需 AppConfig.router.idle.targets。显式预加载省略 trigger 时只加载指定代码，不替代授权。并发加载去重，失败可重试。

应用 router 配置可用 history 工厂，或 mode:'hash'|'history' 与 base；两种方式互斥。guards 是同步工厂，返回守卫数组。原生非托管 History/hash 改写不会被猜成可恢复导航；通过 Router 管理导航。

## 资源与主题

| API                               | 参数 / 返回                                                    | 默认与约束                                                       |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `defineAssetGroup`                | `{name,entries} → AssetGroup<E>`                               | image/atlas/audio/json；json.parse 同步，optional 可失败         |
| `context.assets.load`             | `(group,{signal?,onProgress?}?) → Promise<AssetGroupLease<E>>` | get(key)/release；退出后不可读，共享池默认并发 4                 |
| `defineTheme`                     | `{name,tokens,assets} → ThemeDefinition`                       | token 为 string/number，assets 语义键                            |
| `extendTheme`                     | `(base,{name,tokens?,assets?}) → 同族派生主题`                 | 仅覆盖已有键、资源描述整体替换                                   |
| `context.useTheme / app.useTheme` | `默认主题契约 → ThemeContext`                                  | 返回实际选定主题的 name/tokens/resolve/load                      |
| `ThemeContext.resolve`            | `key → ThemeAsset`                                             | 只解析，不加载；image 或 atlas-region                            |
| `ThemeContext.load`               | `(key,{signal?}?) → Promise<ThemeImageLease>`                  | image/frame、fallback/diagnostic/release；失败只回退最初默认一次 |

AssetTransport 为 load(entry,signal) 和可选 release(entry,raw)。应用传入同步 transport 工厂；image/atlas 的 raw 要有 source/width/height，audio 要有 ArrayBuffer，json 要有待解码值。进度为固定条目计数 total/completed/failed/pending 和 status。租约归实际 owner，调用方不能把共享资源交给已退出页面。

示例与浏览器 JSON 适配见 [资源与应用服务](application-services.md)；默认参考 transport 并不内置 JSON fetch。

## 视口、动作、场景与反馈

| API               | 参数 / 返回                                                             | 默认与约束                                                                |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createViewport`  | `{canvas,width,height,scope,fit?,maxPixelRatio?,driver?} → Viewport`    | fit 仅 contain，DPR 上限默认 2 且不可超过 2；layout()/toGamePoint/dispose |
| `defineActions`   | `entries → ActionDefinitions`                                           | axis 的 negative/positive，button 的 keys/pointer；可设 preventDefault    |
| `createActions`   | `{definition,canvas,viewport,scope,host?} → Actions`                    | read/setVirtual/clear/setActive/dispose；不启动循环                       |
| `defineGameScene` | `{id,actions?,prepare?,setup,onPause?,onResume?} → GameSceneDefinition` | prepare 可异步，其他钩子同步，props 普通数据                              |
| `GameCanvas`      | `内置组件`                                                              | scene/options 为 required 引用，props 默认 {}；需显式注册                 |
| `createGameClock` | `{scope,source?} → GameClock`                                           | advance(delta)/setActive/dispose，独立使用时由已有循环推进                |

GameCanvasOptions 关键参数：width/height 正有限数、background?、maxPixelRatio?；driver/createRenderer/clock 为注入扩展，普通页面无需提供。挂载后 options 固定。ready/error/statusChanged 输出句柄/错误/状态；状态为 idle/preparing/running/paused/stopped/disposed。GameCanvasHandle.status 是 signal，pause/resume、异步 restart/switchTo、forScene(scene).setVirtual 可用。组件字段不能跨 scene/props 静态关联，switchTo 保留关联类型。

GameSceneContext 有 props/prepared/world/clock/actions、create/addSystem、scope/signal、assets/audio/useStore/useTheme。固定系统在采样动作并推进 clock 后执行，phase:'render' 用于渲染阶段。场景的 Engine 来自底层 context，但通用 UI 不应直接操作它。

GameClock.after/every(seconds,callback) 返回 status/cancel 句柄，秒数必须正有限。every 每步最多触发一次；tween({from,to,duration,easing?,onUpdate,onComplete?}) 支持数值或同键数值对象，easing 默认 linear。计时/缓动回调同步，抛错移除任务并带来源报告。scene.clock 已由 GameCanvas 固定步推进，禁止叠加时钟/帧循环。

示例：[2D 场景教程](application-gameplay.md)。

## 音频、保存与账号

| API                                       | 参数 / 返回                                                    | 使用要点                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app.audio / context.audio / scene.audio` | `AudioControls`                                                | state/preferences、unlock、playMusic/playEffect、pauseMusic/resumeMusic、setVolume/setMuted/restorePreferences |
| `defineSave<S,D>`                         | `{key,version,select,parse,restore,migrate?} → SaveDefinition` | 版本正整数；同步白名单/解析，业务显式 restore                                                                  |
| `new SaveService`                         | `{storage?,namespace?}?`                                       | 默认惰性 localStorage、anonymous；用户 namespace 固定 userId                                                   |
| `SaveService.save`                        | `(definition,state) → saved/invalid/unavailable`               | 只有存储 set 成功才 saved                                                                                      |
| `SaveService.load`                        | `definition → loaded/empty/corrupt/incompatible/unavailable`   | loaded 有只读 data 和可选 migratedFrom，不自动恢复/改写                                                        |
| `SaveService.reset`                       | `definition → reset/unavailable`                               | 只删除当前命名空间下指定键                                                                                     |
| `createLocalStorageAdapter`               | `storage? → StorageAdapter`                                    | get/set/remove 为异步接口，实际 localStorage 按需访问                                                          |
| `new AuthService`                         | `{scope,provider}`                                             | session/generation/disposed、ensureSession/login/logout/invalidate/registerCleanup/dispose                     |
| `new AccessService`                       | `{auth,keys,permissions}`                                      | can 同步展示判断，check 异步确认会话；allow/deny(reason)                                                       |
| `createAccessGuard`                       | `{access,resolve,anonymous?,forbidden?} → RouteGuard`          | 在应用 router.guards 装配；重定向目标显式 public                                                               |
| `resolveAccessReturnTarget`               | `(value,{resolve,login,fallback}) → string`                    | 校验站内返回目标，导航仍须经过守卫                                                                             |
| `bindAccessRouter`                        | `{auth,router,scope} → Cleanup`                                | 账号变化时使受保护页面/待提交导航失效                                                                          |

audio 配置需要 assets；driver 同步工厂、ownsDriver 默认 true、maxEffects 默认 16、effectPolicy 默认 drop-new。AudioState 为 locked/ready/suspended/failed/disposed；unlock 返回 ready/blocked/failed/cancelled；播放返回 played(playback)/blocked/failed/cancelled。音量 0—1、master×分组，music 默认循环；未解锁不排队补播。页面/场景音频按 owner 释放，不等同全局音量私有化。

AuthProvider 提供 restore/login/logout/decode，session 初始 unknown，恢复中 restoring，失败 failed；有效身份为 anonymous/authenticated。logout 失败可同时 localCleared:true、remoteRevocation:unconfirmed，不能宣称服务器已撤销。AccessPolicy 为 public 或 required session + all/any；缺失/无效策略不放行。业务服务端独立授权，示例见 [账号适配](../../examples/auth-adapter/README.md)。

## 错误与诊断

| 类型                                                           | 主要来源                                                |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| ComponentError / TemplateError                                 | 组件生命周期、模板表达式和原 HTML 位置                  |
| StoreError / ServiceError / ApplicationError                   | Store/action/task、Provider 与应用装配                  |
| RouteError                                                     | resolve、guard、load、prepare、commit、history、cleanup |
| AssetError / ThemeError                                        | 资源组/键/URL、主题和回退                               |
| ViewportError / ActionError / GameSceneError / CanvasHostError | 视口、输入、场景与宿主                                  |
| GameClockError / TweenError                                    | 同步计时/缓动回调及任务来源                             |
| AudioError / SaveError / AuthError / AccessError               | 设备/播放、存档、会话、权限                             |

先检查 status 判别结果，再检查错误的 module/source/operation/cause。手工 dispose 的清理错误仍可同步抛出；不要用 catch 吞掉所有失败后展示“成功”。编译诊断定位原 HTML，真实浏览器、音频、焦点和性能结果单独记录。
