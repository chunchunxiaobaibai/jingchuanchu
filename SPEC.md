# 下一阶段实施规格：网页 2D 游戏应用框架

状态：实施规格草案，产品范围依据本轮已确认需求；接口细节供实施评审。当前发布版本仍是 0.4.0。本文及链接规格描述待实现能力，任务完成前不得当作现有 API 或验证结果。

这是下一阶段唯一规格入口；执行顺序见 [plan](tasks/plan.md)，完成状态见 [todo](tasks/todo.md)。各模块只定义自己的契约，公共约束不重复抄写。现有 0.4.0 用法见 [使用手册](docs/development/application-suite.md)。

## 产品目标与边界

为网页 2D 游戏提供页面、组件、路由和主题组成的应用骨架；Canvas、ECS 与场景是页面内可管理的能力。用一款完整轻量 2D 参考游戏验证创建、加载、游玩、暂停、设置、结算、重开与交付，不能仅用移动圆形或生成目录判定完成。

确定范围：原生 TS/HTML/CSS 或 Less 三文件，组件输入/输出与 model，细粒度响应式、业务 Store、路由懒加载/预加载、开发者主题图片替换、Canvas 生命周期、屏幕/输入适配、资源加载反馈、音频、基本反馈动画与计时、保存恢复，以及可选认证/权限接入。

不做 3D、编辑器、复杂刚体、骨骼动画、瓦片地图平台、SSR、账号数据库或玩家上传皮肤入口。以后根据真实 2D 需求扩展，不预先搭通用插件市场。现有 Canvas 2D 后端继续使用；性能结论必须来自测量。

## 能力地图与规格

| 模块 ID              | 规格                                               | 依赖                                                              |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| reactive-core        | [响应式](docs/specs/reactive-core.md)              | 现有 core/Scope                                                   |
| component-model      | [组件与模板](docs/specs/component-model.md)        | reactive-core                                                     |
| state-store          | [业务 Store](docs/specs/state-store.md)            | reactive-core                                                     |
| application-services | [应用与作用域](docs/specs/application-services.md) | component-model、state-store                                      |
| page-router          | [页面路由](docs/specs/page-router.md)              | application-services                                              |
| asset-loading        | [资源加载](docs/specs/asset-loading.md)            | 现有 assets、Scope                                                |
| theme-assets         | [主题](docs/specs/theme-assets.md)                 | asset-loading、reactive-core                                      |
| viewport-input       | [画布适配与输入](docs/specs/viewport-input.md)     | 现有 renderer/input、Scope                                        |
| game-feedback        | [计时与缓动](docs/specs/game-feedback.md)          | 现有固定步、Scope                                                 |
| audio                | [音频](docs/specs/audio.md)                        | asset-loading、Scope                                              |
| save-data            | [保存恢复](docs/specs/save-data.md)                | state-store、可替换存储接口                                       |
| canvas-host          | [页面内游戏](docs/specs/canvas-host.md)            | application-services、theme-assets、viewport-input、game-feedback |
| auth-session         | [认证会话](docs/specs/auth-session.md)             | application-services、state-store、后端适配                       |
| access-policy        | [权限](docs/specs/access-policy.md)                | auth-session；由 app 接到路由                                     |
| project-tooling      | [CLI 与构建](docs/specs/project-tooling.md)        | 各运行模块的公开契约                                              |
| reference-game       | [参考游戏与交付](docs/specs/reference-game.md)     | 默认单机能力；认证另用接入示例验证                                |

组件和 Store 不依赖 Router、主题或具体游戏；Router 不导入具体认证 Provider。应用装配守卫与服务。既有 core/ecs 不反向依赖 app 或构建工具。上述 ID 是规划单元，不要求新增同等数量的 npm 包。

## 代码与公开入口

新增应用模型集中从 `@xiaobaibaifqy/jingchuanchu-app/application` 导出，对应 `packages/app/application.ts` 和 `packages/app/runtime/`。现有根入口的 defineView/defineGame、核心包名、函数名及子入口保持原契约；新实现不借同名函数静默改变旧行为。新运行模块首次使用现有 assets/renderer 时补齐包依赖，工具依赖继续仅在 tooling 中。

新增 defineComponent、definePage、defineApplication、mountApplication、bootstrapApplication 及各规格定义的类型/函数；本次固定这一组名称，后续变动先更新规格和调用示例。组件构造采用 setup，生命周期沿用明确的八个钩子；setup 是实例构造函数，不另造第二套生命周期。

新模板属于下一版本的默认开发方式。0.4.0 Release 不替换、不移动标签；发布版本号在发布任务中统一决定，本次不改版本、不上传。旧项目主动迁移，新生成项目不再附带旧 UI 范式作教学代码。

## 业务目录与命名

```text
src/
  main.ts
  app/               app-config.ts、app-routes.ts、app-shell.ts/html/css 或 less
  pages/play/        play-page.ts/html/css 或 less、play-scene.ts、必要的 play-store.ts、私有 hud/
  game/session/      跨页面 game-store.ts、游戏规则与数据
  components/        真正复用的 icon-button/ 等三文件组件
  account/           可选 auth-provider.ts、session-store.ts、access-policy.ts
  themes/default/    default-theme.ts、assets/
  assets/            非换肤公共资源
  styles/            全局基础样式
```

业务文件/目录统一小写 kebab-case，如 play-page.ts、play-scene.ts；三文件同主名。导出定义用 PascalCase，普通值/函数用 camelCase。package.json、tsconfig.json、vite.config.ts 等工具文件名保持工具要求。

页面私有内容就近放页面；跨页面游戏业务进 game；公共 UI 不导入页面、游戏内部或 Engine；game 不导入 DOM/pages/app。类型随所属业务保存，不创建全局 AppState/AppCommands 或 shared/utils 杂物目录。不生成空目录或没有职责的包装层。模型可直接在组件 TS 声明，仅复杂度需要时拆文件。

## 验证与交付约束

- 使用已有 TypeScript、node:test、tsx 和 Node DOM 模拟能力。测试仅覆盖新核心行为、具体缺陷和必要兼容性，不为文件布局或常量写重复实现测试。
- 类型改变执行 `npm run typecheck`；模块任务执行其定向测试。新测试文件在创建后再运行；规格中的未来命令不表示目前存在这些测试。
- 模板阶段使用 `npm run check:templates`、`npm run test:project`；分发阶段才使用 `npm run dist:release` 和 `npm run test:app:distribution`，按需补独立包消费。不把完整分发或浏览器测试放进每项任务。
- 不自动启动浏览器、Playwright、页面操作或截图。参考游戏的实际游玩、音频解锁及目标设备表现留有独立人工验收项；取得明确授权后才执行相应浏览器验证。
- 所有模块有 Scope 所有权、取消和错误来源。对界面批处理、导航代次及用户状态代次分别建模，不用任意延时掩盖同步问题。
- 凭据不进入展示状态、日志或默认持久化；HTTP/WebSocket 权限仍由业务服务端验证。玩家皮肤导入只预留资源来源边界。

## 阶段完成判据

第一阶段：昵称表单与可复用组件能自动响应，Store 能跨页共享且应用实例隔离；编译器能指出绑定错误。

第二阶段：菜单、游戏、设置和结算能经路由衔接；预加载不启动游戏，离页释放活动，DOM 和 Canvas 均按主题资源键显示。

第三阶段：参考游戏完成资源加载、音频、输入适配、计时/反馈和进度保存；独立生成项目可以静态构建。

第四阶段：可选认证/权限通过带后端适配的接入示例验证；打包后的默认单机应用不强制依赖账号服务。

每阶段应提供可评审源码、定向验证记录和剩余人工验收项。规格/计划完成不等于实现完成，不填虚假的性能目标、完成比例或检查结果。
