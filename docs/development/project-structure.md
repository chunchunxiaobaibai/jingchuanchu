# 游戏项目结构与开发约束

当前默认模板已接入应用套件：同名 TS/HTML/CSS 或 Less 自动关联，支持 defineView、生命周期及 create/generate。新流程与主动迁移见 [应用套件手册](application-suite.md)。下文保留手工 CSS Modules 结构作为兼容与迁移参考。

新版原生 TypeScript 模板参考 Cocos 的场景/生命周期责任和 Vue 的组件聚合思想，不依赖 Vue。UI 按组件组织 HTML、行为与局部样式，游戏逻辑保持独立。

## 从模板开始

使用新生成的分发套件 `starters/browser`，执行：

```bash
npm install
npm run check
npm run build
npm run dev
```

`check` 先检查项目结构，再检查 TS；`build` 先执行 check，再进行 Vite 静态构建。`dev` 用于本地开发，不代替检查。`npm run check:structure` 可单独检查结构。

只安装引擎 tgz 不会自动约束已有项目。已有项目需要主动采用模板目录、检查脚本及 package.json 中的开发依赖和命令，再把 check 接入自己的构建或 CI。不要覆盖已有文件。

## 文件放在哪里

| 路径                   | 责任                                              |
| ---------------------- | ------------------------------------------------- |
| index.html             | 元数据、空的 app 挂载点、唯一 main.ts module 脚本 |
| src/main.ts            | 全局基础样式导入和启动应用                        |
| src/app                | 引擎组装、平台输入转换、UI/游戏桥接和页面生命周期 |
| src/contracts          | 跨层的命令、输入与只读状态类型                    |
| src/game/scenes        | 场景组装及实体、系统和资源的生命周期              |
| src/game/components    | ECS 数据或场景数据类型                            |
| src/game/systems       | 更新规则，不访问 DOM                              |
| src/ui/components/名称 | 同名 名称.ts、名称.html、名称.module.css          |
| src/ui                 | UI 组件与模板加载等 UI 工具                       |
| src/styles             | 全局基础样式与主题变量                            |
| src/assets             | 可导入的图片等资源；有需要时再创建                |

不要向 src 根目录继续堆积 game.ts、view.ts 或 style.css。不要将玩法代码放入引擎包或 vendor 安装包。

## 依赖和数据流

```text
main → app → game → contracts
           → ui   → contracts
```

app 和 game 可使用引擎公开入口；ui 不能导入 Engine、World 或 game；game 不能导入 ui/app 或访问浏览器 DOM；contracts 不引用这些层。跨层导入包括 export、类型导入和静态动态导入，tsconfig paths 别名也参与解析。

键盘、指针由 app 适配为 MovementInput 或 GameCommand。游戏更新由 SceneManager 管理的系统执行，UI 通过 GameSnapshot 渲染暂停、运行或错误状态。UI 发出 toggle-pause，app 调用 engine.pause/resume；UI 不直接修改 ECS。

## 三文件 UI 组件

```text
src/ui/components/GameHud/
  GameHud.html
  GameHud.ts
  GameHud.module.css
```

TS 导入同目录 `./GameHud.html?raw` 和 `./GameHud.module.css`；静态模板加载器初始化节点，再给根元素添加 `styles.root`。HTML 使用 data-ref 标记交互节点，组件 TS 注册监听器并提供 dispose 清理。状态文本采用 textContent，避免重复修改相同文本。

组件 CSS 使用局部类开头，例如 `.root button`，不使用 :global、裸的 body/button 选择器或 @import 导入全局样式。主题变量定义在 src/styles，组件读取变量。CSS Modules 隔离类名，不隔离继承属性，也不能证明任意后代选择器不会影响嵌套组件；仍需保持组件选择器明确。

HTML 不使用内联 script/style、事件属性和 style 属性。TS 不嵌入 HTML，静态加载器是唯一可赋值 innerHTML 的位置，不能传入用户输入或运行时拼接 HTML；动态内容用 textContent。布局和视觉状态通过 CSS 类管理，不写 element.style/cssText。

## 检查覆盖范围

错误会显示文件、行号和规则名，命令非零退出：

- file-location / component-files：目录归属、组件命名及配套文件。
- dependency-boundary / engine-internals：跨层依赖或引用引擎内部源码/产物。
- unresolved-import / dynamic-import：未解析的别名或无法静态检查的导入。
- game-dom：游戏/契约层引用常见 DOM API 名称。
- html-shell / html-inline / embedded-markup / embedded-style：页面外壳或 HTML/TS 内联代码。
- css-scope / css-syntax：组件样式越界或 CSS 解析错误。

这是默认模板的静态约束，不是对所有 JavaScript 行为的完整证明。第三方库内部行为、动态反射、间接 DOM 调用和纯语义性的职责划分仍依赖类型、审阅和实际使用验证；禁止通过别名或动态代码刻意绕过规则。

## 迁移旧项目

1. 将旧 main.ts 的引擎组装和输入适配移至 src/app，入口只保留启动。
2. 将旧 game.ts 的实体创建移至 scenes，数据类型移至 components，移动等规则移至 systems；沿用 Scene/Scope 清理。
3. 将根 HTML 中的游戏界面移入 UI 组件模板，留下 app 挂载点。
4. 将旧 style.css 的主题/重置移至 styles，组件样式移至各自 module.css。
5. 通过 contracts 连接命令和状态，将直接访问 Engine/World 的 UI 代码移至 app。
6. 复制模板 scripts/check-project.mjs、所需开发依赖及 check/build 命令，逐项修复诊断后运行自己的测试。

本次未自动迁移 my-game，也未覆盖该项目已有的 0.4.0 分发副本。

参考：[Cocos 项目结构](https://docs.cocos.com/creator/3.8/manual/en/getting-started/project-structure/index.html)、[Vue 组件组织](https://vuejs.org/guide/scaling-up/sfc.html)、[Vite CSS Modules 与 raw 导入](https://vite.dev/guide/features.html)。
