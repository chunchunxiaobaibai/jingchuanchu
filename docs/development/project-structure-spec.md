# 原生 TypeScript 应用开发套件规范

更新日期：2026-10-16。本文整合用户讨论确定的开发方向，作为后续设计、实现与验收的依据。

状态：应用开发套件和代码生成脚手架已在本地 0.4.0 实现，新增 app 运行包和 tooling 开发包。本文保留设计要求及历史拟议示例；可执行命令、最终接口和迁移步骤以 [应用套件手册](application-suite.md) 为准。本轮已授权实现，仍不授权 npm 发布或迁移外部 my-game。

## 1. 目标与使用层次

开发者可以只使用核心引擎自由开发，也可以采用应用开发套件、模板和脚手架。默认开发规范由接口、类型、编译工具和运行时共同提供，减少手工组装、订阅、DOM 更新和清理工作；提高内聚性、降低耦合。

| 层次 | 提供的能力 | 使用约束 |
| --- | --- | --- |
| 核心引擎 | ECS、循环、渲染、输入、资源和网络 | 按需安装，保留自由组织应用的能力 |
| 应用开发套件 | 应用/场景/UI/输入声明，类型化通信，统一挂载与生命周期 | 套件上下文及构建流程提供默认边界 |
| 模板与脚手架 | 创建项目、生成组件/场景、配置开发服务与打包 | 自动生成并接入上述能力，无需手动搭建 |

保持原生 TypeScript，不引入 Vue、React 或 Angular 运行时。已有引擎包名、函数名和公开入口保留；应用开发套件采用新增能力，不把其规则强加给核心用户。

## 2. 基本开发接口

| 拟议接口 | 责任 | 上下文边界 |
| --- | --- | --- |
| defineGame | 声明应用配置、场景、输入、初始状态及应用级命令 | 应用组装与控制 |
| defineScene | 声明游戏场景、实体、系统与资源生命周期 | 场景游戏能力，不提供 DOM/UI 实例 |
| defineView | 声明 UI 组件、子组件、文件元数据及生命周期 | 输入属性、只读游戏状态、组件局部状态、命令和 UI 绑定 |
| defineInput | 声明键盘/指针到输入状态或命令的映射 | 平台输入适配 |
| bootstrapGame | 按根组件 selector 寻找宿主并启动应用 | 返回可销毁的应用实例 |
| mountGame | 将根组件显式挂载到传入 DOM 容器 | 适用于嵌入已有页面，返回可销毁的应用实例 |

组件定义是可复用描述；每次挂载创建独立实例、上下文、局部状态、订阅及生命周期。引擎和 UI 运行时不得把这些实例状态写入共享定义对象。

## 3. 组件身份与挂载

组件通过导出的定义引用使用，不要求开发者提供 id。根组件通过 selector 匹配宿主；子组件通过父组件的 components 引用列表，在父模板内解析其 selector。

```ts
// 拟议用法：HTML、样式由构建工具按同名规则关联。
export const GameHud = defineView({
  selector: 'game-hud',
  onMount(context) {
    context.on('pause', 'click', () => {
      context.commands.send('togglePause', undefined)
    })
  },
})

export const GameApp = defineView({
  selector: 'game-app',
  components: [GameHud],
})
```

父模板用 `<game-hud></game-hud>` 组合组件；页面用 `<game-app></game-app>` 提供根宿主。selector 是模板标签，不是全局字符串注册 ID。父组件范围内重复的 selector 必须给出明确诊断；多个实例通过实例引用区分。

```ts
// 拟议入口：gameDefinition 是 defineGame 返回的应用配置。
const app = await bootstrapGame(GameApp, gameDefinition)
// 嵌入已有页面时，改用：await mountGame(containerElement, GameApp, gameDefinition)
app.dispose()
```

挂载 API 不要求 DOM 容器使用 id。自动启动时必须找到唯一根宿主，否则报告错误；显式挂载直接使用传入元素。重复挂载到已被管理的宿主不能静默覆盖现有应用。启动与销毁分别承担实例创建和资源释放责任。

应用层场景选择同样优先使用定义引用，例如 initialScene: PlayScene、scenes: [PlayScene]。已有内核的模块/系统/场景 ID 机制保留，由适配层满足内核要求，不让新增组件承担人工维护 id 的责任。

## 4. 模板与样式自动关联

```text
src/ui/components/game-hud/
  game-hud.ts
  game-hud.html
  game-hud.less                 或 game-hud.css
```

同目录同名关联作为默认约定。组件 TS 只声明行为与元数据，不需要自行 import HTML、Less、CSS，也不需要 ?raw 或 styles.xxx。构建工具负责发现配套文件、生成实际依赖及运行时组件资源。

特殊目录组织允许显式配置，路径相对于组件 TS 文件：

```ts
defineView({
  selector: 'game-hud',
  templateUrl: './templates/hud.html',
  styleUrl: './styles/hud.less',
  onMount(context) {
    // 组件行为
  },
})
```

缺失模板、显式路径不存在、默认同名 CSS/Less 同时存在产生歧义时，构建必须报错，不能随意选一个。样式可省略；没有同名样式且未声明 styleUrl 时创建无样式组件。路径必须是构建期可确定的静态值。

关联发生在编译阶段，不依赖组件在浏览器中按相对路径 fetch 源文件。依赖应参与开发服务监听及热更新，修改配套文件不能要求开发者重新手动关联。编译错误和运行时诊断保留组件来源信息；生成产物无需人工维护。

## 5. CSS、Less 与样式作用域

- 脚手架支持选择 CSS 或 Less，自动配置需要的开发依赖。Less 属于构建工具，不成为核心引擎运行依赖。
- 开发者写普通组件类名，例如 HTML 中 class="pause-button"，样式中 .pause-button；不强制 .module.less、data-class 或 styles.xxx。
- 构建工具自动处理组件样式作用域，并保持 HTML 类名与处理结果对应。组件之间的样式隔离由套件负责，不能只靠开发者给类名增加前缀。
- CSS 与 Less 使用相同组件接口。Less 可以引用共享变量、混入及其他样式文件，正常 @import 不被一概禁止。
- 全局主题、重置及共享基础样式通过应用配置/构建配置集中接入；组件不能隐式扩大为全局样式。
- Less 先编译为 CSS，再进行作用域处理和相应检查。通过 source map 将错误定位回原始 Less 及导入文件。
- 默认作用域限制组件样式向外影响，不承诺阻断所有全局样式和继承属性向内影响。具体隔离策略及子组件宿主规则须在实现时明确并验证。

## 6. 类型化通信和状态归属

```ts
export interface GameCommands {
  moveTo: { x: number; y: number }
  togglePause: undefined
}
export interface GameState {
  score: number
  paused: boolean
}
```

命令名、负载、组件输入和状态选择结果必须有类型检查。游戏向 UI 暴露只读展示状态，不暴露 Engine、World、Entity 或可变 ECS 数据。UI 可维护自己的局部状态，不能通过展示快照反向修改游戏。

```text
输入 / UI → 类型化命令 → 应用控制或当前场景
当前场景 → 只读展示状态 → UI 状态绑定
父组件 → 类型化输入属性 → 子组件
```

应用控制命令与场景命令必须有明确归属；同一活动作用域内同一命令不能出现冲突处理器。场景退出自动注销场景处理器。连续移动等高频输入提供可由固定步系统读取的输入状态，不要求全部转换成 UI 状态或离散命令。

UI 套件提供声明式文本/属性/事件绑定，自动订阅、仅更新变化内容并自动清理。运行时文本不得通过拼接 HTML 更新。模板绑定的具体语法另行细化，但必须能校验组件公开的输入、状态与动作，不暴露整个游戏上下文。

## 7. 指定组件生命周期

组件采用以下固定钩子；开发者按需声明，未声明的钩子由运行时跳过。钩子不是必须自行调用的普通公共方法。

| 钩子 | 触发时机 | 责任 |
| --- | --- | --- |
| onInit | 初始输入属性就绪后、创建视图前，一次 | 初始化组件局部状态，不能访问尚未创建的节点 |
| onMount | 模板、子组件与样式就绪并插入 DOM 后，一次 | 获取节点、接入外部交互 |
| onInputsChanged | 已挂载组件的父级输入属性发生变化 | 根据 previous/current 输入更新内部状态 |
| onBeforeUpdate | 将要进行实际视图更新前 | 更新前准备 |
| onUpdated | 本次 DOM 更新完成后 | 读取布局、同步外部控件 |
| onActivate | 已挂载实例从停用状态恢复 | 恢复外部活动 |
| onDeactivate | 暂时停用，实例与视图保留 | 暂停外部活动 |
| onDestroy | 实例最终销毁、其自身节点移除前，一次 | 释放未由套件管理的外部资源 |

```text
创建实例 → 初始输入就绪 → onInit → 创建并挂载视图 → onMount
输入变化 → onInputsChanged → onBeforeUpdate → 更新 DOM → onUpdated
暂时停用：onDeactivate ↔ onActivate
最终销毁：onDestroy → 自动清理 → 移除自身视图
```

初始输入不额外触发 onInputsChanged，初次挂载不额外触发更新钩子。同一批输入变化合并通知并提供变化前/后的值；没有实际视图更新时不触发 onBeforeUpdate/onUpdated。内部状态更新可以触发视图更新，但不能冒充父级输入变化。

setup 不再作为 UI 的另一套生命周期；初始化行为归 onInit，节点相关行为归 onMount。场景的 setup 沿用核心场景语义，与 UI 钩子区分。

## 8. 生命周期顺序、资源和异常

- 每个组件实例独立执行钩子。父组件先 onInit；子组件 onMount 完成后再执行父组件 onMount。
- 同一更新批次中，父级先进行更新前准备和输入传播，子级完成更新后再执行父级 onUpdated。在更新钩子中再次修改状态属于下一更新批次，不同步递归执行钩子。
- 销毁时先销毁子组件，再执行父组件 onDestroy；每个实例的 onDestroy 发生在其自身节点被移除前。已销毁实例不能重新激活，重复 dispose 不重复调用钩子。
- context 注册的监听器、订阅和资源自动归实例所有。外部资源通过 context.own(cleanup) 登记，并按 Scope 语义释放；开发者不必为套件管理的注册重复写清理代码。
- 钩子默认同步，不等待 Promise。异步任务使用组件取消信号，销毁后取消，不能再更新已销毁实例；异步加载通过明确的准备/加载流程完成。
- 初始化或挂载失败时清理已创建的组件和登记资源；销毁钩子或清理函数失败仍继续其余清理，再汇总报告。错误带组件来源和生命周期名称。
- UI onUpdated 不对应游戏每帧 tick。游戏固定步由场景系统负责，不能在 UI 中新增第二个游戏循环。
- 游戏暂停不自动停用 HUD；暂停按钮和状态界面仍可交互。
- 首阶段实现 onInit/onMount/onInputsChanged/onBeforeUpdate/onUpdated/onDestroy。onActivate/onDeactivate 随实例缓存/停用能力实施；未支持前不宣称这两个钩子已可用。

## 9. 场景与输入生命周期

场景沿用已有 SceneManager 和 Scope：prepare 用于可取消的异步资源准备，setup 同步创建实体、系统及命令处理器；pause/resume 管理游戏活动，dispose 释放场景资源。由上下文创建/注册的内容归场景所有。

输入套件负责键盘焦点、指针坐标转换、监听器清理及明确的暂停派发策略。场景声明游戏规则，UI 声明展示，app 负责平台及能力组装。场景生命周期和 UI 生命周期相互协调，但不能混为同一事件。

## 10. 推荐项目归属和依赖

```text
index.html                    根宿主与启动脚本
src/main.ts                   启动应用
src/app/                      应用配置、根组件及适配
src/contracts/                命令、状态及输入契约
src/game/scenes/               场景声明
src/game/components/           ECS/场景数据
src/game/systems/              固定步更新规则
src/ui/components/<名称>/     同名 TS、HTML、CSS 或 Less
src/styles/                   全局主题、重置、共享 Less 变量和混入
src/assets/                   图片等资源
```

app 可组装 game/ui/contracts 和引擎公共能力；game 不依赖 app/ui/DOM；ui 不直接访问引擎实例或 game 内部；contracts 不依赖上述运行实例。UI 子组件通过组件引用组合，跨层数据通过类型化契约传递。

这些是套件项目的默认组织方式，脚手架负责生成。结构检查仍检查跨层直接导入、内联代码等绕过行为，但只是辅助保障，不能代替运行时上下文边界、类型接口和自动生命周期。

## 11. 脚手架和构建工具责任

脚手架支持核心项目、网页单机、网络客户端及服务端选择；提供创建项目、生成场景、生成 UI 组件、开发和打包能力。生成器自动创建配套文件及必要组件引用，不要求用户手动关联资源。

应用开发套件负责实际执行上述契约；脚手架不能仅生成目录和检查规则后，把组装责任全部交还开发者。开发/构建命令统一接入构建插件、Less 编译、组件关联和类型/结构诊断。

核心用户可以自行组装；套件用户获得默认开发流程。无需公共 npm 发布权限也能通过本地分发包使用套件和脚手架。具体包名、CLI 名称及实现依赖在实施前确定，本文不把不存在的命令描述为已可运行。

## 12. 验收标准

- 核心引擎可独立使用，不被 UI 编译器、Less 或脚手架依赖绑定。
- 开发者可用组件引用和 selector 挂载，不声明组件 id；显式 DOM 宿主可无 id。
- TS 不手动 import HTML/样式；同名关联和显式路径均可构建，歧义/缺失资源准确定位。
- CSS/Less 均可用，变量/混入导入正常，组件普通类名由工具隔离并正确关联模板。
- 多个实例有独立状态和清理；输入变化、更新、父子挂载/销毁顺序符合规范。
- 场景退出、组件销毁和应用销毁自动释放各自登记内容；错误不跳过必要清理。
- 命令/状态/输入具有类型约束，UI 不获得直接修改 ECS 的套件接口。
- 脚手架创建的项目及分发套件可在独立项目中开发、检查与静态构建，不依赖引擎仓库绝对路径。
- 提供现有手工三文件模板的主动迁移说明。未请求时不改写 my-game，不覆盖已有发行副本。

## 13. 当前实现与验证命令

现有 0.4.0 已完成的模板检查使用 npm run check:templates、npm run test:project；npm run dist:release 生成交付包，npm run test:template 验证独立模板安装及静态构建。模板内已有 npm run dev/check/build。

新增套件使用 npm run test:app 验证运行时与工具，npm run test:app:distribution 验证 tgz CLI 与四类预设、CSS/Less 的独立静态构建；check:templates 已纳入组件编译诊断。不自动运行浏览器、Playwright、性能或全量分发验证。

原模板实施记录保留在 [计划](../../tasks/plan.md) 与 [任务清单](../../tasks/todo.md) 中；后续套件实施应建立新的任务范围，不把已勾选任务当作新规范完成证据。

## 14. 参考与设计取舍

- [Cocos 生命周期](https://docs.cocos.com/creator/3.8/manual/en/scripting/life-cycle-callbacks.html)：借鉴生命周期责任，沿用已有场景与 Scope。
- [Vue 组件组织](https://vuejs.org/guide/scaling-up/sfc.html)：借鉴围绕组件聚合逻辑、模板与样式，仍保持原生三文件开发。
- [Angular 外部模板与样式](https://angular.dev/guide/components)：借鉴组件元数据及外部文件关联，不引入 Angular 运行时。
- [Angular 挂载](https://angular.dev/api/platform-browser/bootstrapApplication)、[程序化创建组件](https://angular.dev/api/core/createComponent)：借鉴组件引用、selector 和显式宿主。
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot)：借鉴直接传入 DOM 容器的挂载方式。
- [Vite 样式预处理](https://vite.dev/guide/features.html#css-pre-processors)：利用 CSS/Less 构建能力；组件自动关联、生命周期及绑定仍由本套件提供，不宣称 Vite 已具备这些能力。

当前选择：外部三文件、默认同名关联、可选静态路径、组件引用和标签挂载、自动样式隔离与固定实例生命周期。构建工具承担必要的资源关联，业务代码保留明确的功能与类型依赖。
