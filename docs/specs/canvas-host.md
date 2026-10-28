# canvas-host：页面内的 2D 游戏能力

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/canvas-host.ts；导出 GameCanvas 组件与 defineGameScene 适配，复用原 SceneManager/Engine，不改旧 defineScene 或核心场景语义。

实现进度：T24 自动项已通过；GameCanvas/defineGameScene 与控制句柄已从 application 导出。公开组件、内部 Canvas 装配/控制器、场景/资源所有权在 Node DOM/注入帧队列下验证；真实浏览器、光栅画面与设备输入仍待人工验收。

## 场景契约

defineGameScene({id,actions?,prepare?,setup,onPause?,onResume?}) 定义可复用描述；actions 通过 defineActions 保留场景动作键类型，无动作时可省略。prepare(signal,props) 可异步返回 prepared，setup(context) 取得同一准备结果和拷贝冻结的 props。setup/暂停/恢复钩子只支持同步；异步逻辑放 prepare 或显式任务。context 扩展原 SceneContext 的 create/addSystem/场景资源方法，并增加 world、clock、只读 actions 与显式 assets/useStore/useTheme，不包含页面元素。

内部适配为每次切换/重开创建新的核心 Scene；继续由 SceneManager 处理候选准备取消、调度验证、提交和旧作用域回收，保留旧 defineScene 行为。准备失败保留旧场景，晚到准备结果不能 setup。新增场景所属 clock 系统每固定步只采样一次动作，再推进计时/缓动；场景固定系统显式排在内部 `$game-clock` 之后，render 不跨 phase 依赖。暂停清空可读动作并暂停 clock，同时停用 scene owner 的音频有效态；恢复与继承的页面停用/后台原因组合。底层物理输入和帧驱动由已实现的 GameCanvas 接线。

核心 Scene 适配保持内部入口，由公开 GameCanvas 负责装配。

## 场景服务作用域（内部）

createGameSceneAccess(parentOwner,sceneScope) 为每次 setup 创建独立手动子 owner，继承页面/应用的 Store 与主题 Provider，但资源 lease 归场景所有。sceneScope 退出或父 owner 取消均使访问失效并释放场景持有；离场注销父取消订阅，不把每次重开的清理闭包累积到父 Scope。手动子 owner 允许宿主先停止输入/帧，再回收场景资源。assets 按需读取，无资源 Provider 的纯逻辑场景仍可 setup；Store 仍由原 Provider owner 共享，场景退出不销毁应用 Store。该辅助方法尚待 GameCanvas 实际装配。

## 宿主控制器（内部）

createCanvasHostController 目前只接管独立 Engine/SceneManager 与注入 BrowserDriver；场景访问接口由 services 工厂按候选 scope 注入，物理输入可提供 setActive/clear 接口。首次提交前不启动循环；准备期间旧场景继续运行，只有已提交候选才更新 restart 目标。restart 使用上次提交的 props 快照。退出先停输入与帧驱动，再回收 Engine/场景；晚到准备结果不能启动驱动。

手动暂停、页面停用、宿主隐藏和外部 Engine 暂停分别保存。可见通知只移除隐藏原因，不覆盖手动/页面/外部暂停；外部 stop 或帧错误后不因可见通知而自动重启。复用 runBrowser 的帧调度，但可见性由本控制器管理，避免自动恢复抹掉暂停意图。该层尚未创建 DOM、Renderer 或 GameCanvas 组件。

## Canvas 运行实例（内部）

createCanvasRuntime 组合独立 Canvas2D、createViewport、createActions、场景服务与宿主控制器。默认视口驱动接受同一 Renderer 的内部注入，尺寸和坐标换算不再额外创建第二个 Canvas2D。每次场景实际提交后才替换动作绑定，准备失败保留旧绑定；每次替换回收旧捕获和监听，不向宿主 Scope 累积旧绑定。场景固定步读一次动作；render 阶段清背景并 drawWorld，零尺寸不绘制。

默认帧驱动使用 Canvas 所属文档的 window，支持注入帧队列及 Renderer 工厂作 Node 验证。父 owner/显式 scope 退出及外部 Engine.dispose 都先停止输入和帧，再释放场景、动作、视口、Renderer 并清零像素缓冲。同一 Canvas 不重复接管，退出后可重新装配；此方法保持内部入口，由 GameCanvas 页面组件提供输出和交互句柄。

## 页面输入前提

场景定义与含函数的宿主选项需要显式 `input<T>({required:true,mode:'reference'})`；普通 input/signal 仍只接受纯数据。引用模式已验证父模板属性绑定、setInputs、change 快照与回滚身份，GameCanvas 接线时 scene/options 使用该模式，场景 props 继续为纯数据。

## 页面组合

```html
<game-canvas :scene="PlayScene" :options="canvasOptions" />
<play-hud :score="score" @pause="pauseGame()" />
```

GameCanvas 是可由页面引用的组件，输入为 scene 定义、逻辑尺寸/视口/动作配置及场景初始参数；输出 ready、error、statusChanged。页面取得有类型的游戏能力句柄，可暂停、恢复、重开或切换该宿主的场景，不把 Engine 放入通用 HUD 的上下文。

defineGameScene 返回可适配到核心 Scene 的描述，包含 prepare(signal,props)、setup(context) 及暂停/恢复钩子。context 只向游戏规则开放 engine/world、Scope、游戏 clock、只读动作状态、资源持有及显式 Store/主题访问；没有页面 DOM。HUD 与场景通过业务 Store/操作交互。

每个 GameCanvas 默认独占自己的 Engine、Renderer 和驱动。页面离开先停止输入和循环，再释放场景、音频/资源句柄与缓冲；共享底层图片缓存通过 lease 管理。首阶段不开放同一个 Engine 被多个 Canvas 隐式共同驱动。

场景准备失败不退出现有已提交场景；重开使用新场景实例和新作用域，不能重复叠加系统。页面异步退出时旧准备结果不能启动循环。路由预加载只加载模块，不能实例化 Canvas 或解码全部关卡资源。

暂停只停止游戏活动和 clock，页面 UI/设置仍响应；引擎状态、页面停用和手动暂停原因分别管理。页面不可见策略必须保留手动暂停意图。宿主尺寸及指针转换交给 viewport-input，不要求每个 app-config 手写固定坐标公式。

## 直接验收

H1：页面进入只创建一个驱动，离页后系统/实体/监听/播放/资源持有回到基线。

H2：暂停保留 HUD 操作，重开不累加系统，旧异步准备不能复活已退出页面。

H3：同页两个独立宿主不共享 Engine 状态；普通按钮无需引用 Engine 即可控制业务。

测试：tests/canvas-host.test.ts，注入 Renderer/帧驱动验证所有权。真实图像、触控及音频由参考游戏人工验收。

## 已实现的组件入口

显式把 GameCanvas 放到页面 components 中。scene 与 options 是引用输入，props 是默认 `{}` 的纯数据输入。为 `game-canvas` 宿主指定 `display:block` 和明确的 CSS 高度/宽度；逻辑尺寸来自 options.width/height，物理缩放继续由视口管理。options 的 width/height/driver/createRenderer/clock 等为挂载配置，挂载后替换 options 会输出错误并保留原运行实例；需要重建配置时重新挂载，CSS 尺寸变化无需重建。

ready 在初始/切换/重开成功后输出稳定的 GameCanvasHandle；error 输出 CanvasHostError 并保留 cause；statusChanged 输出 idle/preparing/running/paused/stopped/disposed 中的实际变化（退出后可从 handle.status 读取 disposed，不在已退出 owner 上发事件）。handle 提供 pause/resume/restart/switchTo(scene,props)，以及只读 status。页面 deactivate/activate 接入独立停用原因，保留手动暂停。

`handle.forScene(PlayScene).setVirtual('moveX', -1, 'hud-left')` 根据定义保留动作键和值类型，只允许当前已提交定义；切换到其他场景后旧控制器报错。handle.switchTo 保留 props 类型约束；组件 scene/props 作为异构装配输入不做跨字段静态关联，外部不可信 props 应在 prepare 中显式校验。声明式 scene/props 更新走同一准备/提交流程，失败保留已提交场景；命令式 switchTo 不回写页面输入。

Node 验证：tests/game-canvas.test.ts（mountComponent 与实际 mountApplication 模板/共享 Store/退出取消），tests/game-canvas-types.ts（切换 props、虚拟动作和值、只读状态），其余内部生命周期测试仍保留各自范围。这里不代表真实设备或实际游玩已通过。
