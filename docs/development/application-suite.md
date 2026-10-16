# 0.4.0 应用套件与脚手架

本文是现有版本的使用手册。下一阶段的组件、路由、响应式和主题契约以 [SPEC](../../SPEC.md) 为准；旧目录与绑定规则不约束新模型。

本地 0.4.0 新增可选 `@xiaobaibaifqy/jingchuanchu-app` 运行包和 `@xiaobaibaifqy/jingchuanchu-tooling` 开发工具包。原有 8 个引擎包、函数名及入口保留。新包尚未上传公共 npm，请使用本地套件。

## 创建项目

引擎仓库中运行 `npm run dist:release`，生成 `dist/releases/jingchuanchu-engine-0.4.0`。从仓库使用 CLI：

```bash
node packages/tooling/dist/cli.mjs create ../my-game --preset singleplayer --style less --bundle ./dist/releases/jingchuanchu-engine-0.4.0
cd ../my-game
npm install
npm run check
npm run build
npm run dev
```

也可先在工具目录安装分发中的 tooling tgz，再用其 `jingchuanchu` 命令创建项目。`--bundle` 接收解压后的套件目录。安装需要下载或缓存 Vite、TypeScript 等开发依赖；生成器本身不会执行 npm 安装或启动开发服务。

| 预设         | 生成内容                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| core         | Node/TS 内核项目，无 UI 编译工具及 Less                                         |
| singleplayer | 应用、场景、输入、Canvas 和三文件 UI                                            |
| client       | singleplayer 加入已注册的 networkModule；默认 localhost:8080/ws，协议由应用定义 |
| server       | Node HTTP/WebSocketHost 示例与 dev/check/build/start 命令                       |

创建前校验选择包及传递内部依赖的 SHA-256；tgz 复制到项目 vendor，package.json 使用相对 file: 路径。提交 vendor 和锁文件即可迁移，不需要保留引擎仓库绝对路径。生成器拒绝覆盖非空目录。

## 应用与场景

跨层契约在 `src/contracts/application.ts` 定义 AppState、AppCommands、AppInput。defineGame 提供 `state()`、`scenes`、`initialScene`、可选 `input`、`modules(context)`、`setup(context)`、`clock` 和 `onError`。state/local/inputs 只接受可结构化复制的普通对象、数组和原始值，展示快照深度冻结，不允许放入 Engine、Entity、DOM 或类实例。

```ts
const PlayScene = defineScene<AppState, AppCommands, AppInput>({
  setup(context) {
    context.commands.handle('moveTo', (point) => {
      /* 修改场景数据 */
    });
    context.addSystem({
      id: 'movement',
      update() {
        /* 读取 context.input */
      },
    });
    context.scope.own(releaseLevel);
  },
});
```

场景使用定义引用，不要求手工提供 id；适配层通过现有 SceneManager 隔离实例 ID、实体、系统与资源。prepare 接收可取消信号，setup 保持同步。`app.switchTo(Scene)` 要求目标已列在 scenes 中；候选准备失败保留旧场景，成功时注销旧场景命令。应用命令与场景命令重名会报错，同一作用域也禁止重复处理器。

`context.state.update(previous => 新对象)` 更新展示快照。UI 只接收只读 state、inputs、local 与 commands；场景才有 Engine/World。高频输入由 defineInput.read 在固定步开始时采样。键盘绑定在应用宿主中，避开可编辑控件和输入法，失焦、离开宿主和暂停清理键状态。setup 可登记指针等平台适配，使用 `enabled()` 判断是否派发场景输入。

暂停时丢弃场景命令，应用控制命令仍执行。引擎暂停/恢复同步场景钩子，HUD 保持交互。页面进入往返缓存时暂停，恢复时保留原来的手动暂停；正常 pagehide 销毁应用。

## 组件与绑定

```text
src/ui/components/score-panel/
  score-panel.ts
  score-panel.html
  score-panel.less
```

```ts
export const ScorePanel = defineView<AppState, AppCommands>({
  selector: 'game-score-panel',
  text: { status: (context) => context.state.status },
  attributes: { disabled: (context) => context.state.status === 'stopped' },
  actions: { pause: (context) => context.commands.send('togglePause', undefined) },
});
```

```html
<section>
  <span data-text="status"></span>
  <button type="button" data-attr-disabled="disabled" data-on-click="pause">暂停</button>
</section>
```

TS 不导入模板和样式，普通 class 名不需要 CSS Modules。Vite 插件按同目录同名关联文件，也支持静态 `templateUrl`、`styleUrl`。模板必须存在；CSS/Less 同时存在时报歧义；没有样式文件是合法组件。元数据必须是静态 defineView 对象，绑定表须为对象字面量，便于检查 HTML 名称；不支持展开对象或运行时计算资源路径。

`data-text` 对应 text 表；`data-attr-名称` 对应 attributes 表，false/null/undefined 移除属性，true 设置布尔属性；`data-on-事件` 对应 actions 表；`data-ref` 供 `context.element(ref)` 和 `context.on(ref, event, listener)` 使用。名称在 check/build 中校验，值由 TS 绑定函数检查类型。动态文本写 textContent，禁止用文本绑定替换子组件或子元素。

父组件通过 `components: [Child]` 注册可用子组件，再在 HTML 中使用其 selector。相同父范围中的重复 selector 报错。通过 `childInputs: context => [viewInputs(Child, {value: context.state.score})]` 传递受 Child 输入类型检查的属性；第三个 ref 参数可选，只更新带指定 data-ref 的 Child 实例。多个实例拥有独立的 local、输入、订阅与钩子。

## 生命周期与批处理

| 钩子                       | 契约                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| onInit                     | 初始输入就绪；节点尚不可访问                                                       |
| onMount                    | 子组件挂载完成后执行，可访问节点                                                   |
| onInputsChanged            | 同批父级输入合并，提供 previous/current；初次挂载不调用                            |
| onBeforeUpdate / onUpdated | 实际 DOM 绑定变化前/后；无变化不调用，初次渲染不调用                               |
| onDeactivate / onActivate  | 显式 view.deactivate()/activate()；保留 DOM/实例，停用期间暂缓绑定更新及声明式动作 |
| onDestroy                  | 子组件销毁后、自身节点移除前，仅一次                                               |

钩子同步执行，不等待返回的 Promise。异步任务用 `context.signal` 处理取消，最终销毁后禁止 setLocal/setInputs。`context.own(cleanup)`、on、订阅都归实例 Scope；销毁钩子失败仍继续清理，并携带来源及钩子名报告异常。框架管理的注册不需要手写重复清理。

state、local 与 setInputs 使用微任务批处理；没有实际绑定变化不会触发更新钩子。更新钩子中修改状态安排到后续批次，不同步递归进入 UI 更新。UI 更新不等于引擎 tick，不创建第二个游戏循环。

## 挂载、开发与生成

```ts
const app = await bootstrapGame(GameApp, gameDefinition);
// 或 await mountGame(containerElement, GameApp, gameDefinition)
app.dispose();
```

bootstrapGame 要求唯一根 selector；mountGame 接收任意显式容器，无需 id。重复挂载报错；失败启动回收已登记内容，销毁后可重新挂载。调用方应处理挂载/场景切换 Promise 的拒绝。mountGame 第四个可选参数支持 inputs、BrowserDriver 和 autoStart，便于宿主嵌入与非浏览器测试。

```bash
npm run generate -- view score-panel
npm run generate -- scene menu
# 自定义父组件
npm run generate -- view settings --parent src/ui/components/GameApp/GameApp.ts
```

生成组件自动创建三文件、加入父组件引用并插入其模板；生成场景自动加入 gameDefinition.scenes，保留 initialScene。自定义父组件必须包含唯一静态 defineView，场景注册目标必须包含唯一静态 defineGame。文件已存在时拒绝覆盖。

模板 check 包含结构、组件资源/绑定与 TS 检查，build 再执行 Vite。配套文件及 Less/CSS 导入参加监听；更新采用整页重载重建实例。全局主题仍从 main.ts 集中导入，组件样式不允许全局选择器逃逸。Less 导入共享变量和混入正常，组件内部样式按选择器片段隔离，动画名重命名；父组件样式可以影响子组件宿主，不能借后代选择器进入其内部。继承属性与页面全局主题仍可向内生效。

## 迁移现有手工模板

保留原核心 API 和自建项目；迁移由使用者主动选择。为新项目添加 app 运行依赖、tooling 开发依赖和 Vite 插件，把手工 UI 挂载改为 defineView，删除业务 TS 对 HTML/CSS Modules 的导入，把 module.css 换成普通 CSS/Less，将样式类写回 HTML。把旧 render 函数改为 text/attributes 绑定，事件改成 actions 或 context.on；清理由 context.own 登记。场景可暂时适配既有 Scene.setup，如模板中的 PlayScene，再逐步迁移声明。

模板仍保留旧 GameView/GameHud 手工组件用于对照迁移，但新启动路径只使用 GameApp/GameControls。不要把两套 UI 同时挂载。原结构检查继续支持手工 CSS Modules；新组件的资源和作用域由编译器检查。

## 非浏览器验证

```bash
npm run test:app
npm run typecheck
npm run check:templates
npm run dist:release
npm run test:app:distribution
```

test:app 使用 Node DOM 模拟，覆盖状态、组件生命周期、命令/场景、Less 和生成器；test:app:distribution 从 tgz 安装真实 CLI，创建四类预设并检查 CSS/Less 独立静态构建。本轮不启动浏览器；实际页面交互与渲染由用户后续验证。

实现依据：[Vite 7 插件接口](https://v7.vite.dev/guide/api-plugin)、[Less Node API](https://lesscss.org/usage/)。
