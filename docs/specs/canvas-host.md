# canvas-host：页面内的 2D 游戏能力

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/canvas-host.ts；导出 GameCanvas 组件与 defineGameScene 适配，复用原 SceneManager/Engine，不改旧 defineScene 或核心场景语义。

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
