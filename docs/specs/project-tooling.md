# project-tooling：项目、代码生成和构建

公共规则见 [SPEC](../../SPEC.md)。位置：packages/tooling 与模板检查脚本；不把 Vite、Less、TS 编译器变成核心引擎运行依赖。

实现进度：T32 的统一配置、application 路径/结构/TS 依赖诊断与 CLI/模板检查入口分流已通过定向验证，旧结构规则回归通过。T33 已支持 application 组件/页面三文件及页面动态路由注册；新版 create 最小应用骨架也已完成源码条件下检查与页面分块构建；T34 的 scene/store/theme 生成也已通过源码定向检查；T35 add 的摘要/闭包/vendor/依赖记录与事务，以及真实最小 tgz/锁文件离线重装验证均通过；T36 已验证实际包构建、旧API名称、本地tgz导出及独立新/旧应用消费；完整参考游戏交付留对应后续任务。

## 项目配置与命令

新 jingchuanchu.json 使用 schemaVersion:2、profile:'application'、preset、style 及 paths（app/pages/game/components/themes/account）。路径相对项目根，默认见 SPEC；禁止指向项目外进行生成写入。缺失新 profile 的现有配置按 legacy-v0.4 解释，不把旧项目当成新布局检查。

当前 loadProjectConfig(directory) 为只读解析器：缺文件或 schemaVersion 缺失/1 且 profile 缺失/legacy-v0.4 归旧布局；声明 schemaVersion:2 必须同时 profile:application，未知 schema/profile 报 ProjectConfigError，不回退旧布局。preset 仍为 core/singleplayer/client/server，style 为 css/less。声明新 profile 只是选择规则，不自动迁移旧文件。

application paths 默认 app/pages/game/components/themes/account 分别对应 src 下同名目录；允许按键覆盖，拒绝未知键、绝对路径/盘符相对路径、dot 段、非小写 kebab-case 段与业务根互相重叠。Windows 分隔符、开头 ./ 和尾随 / 规范为项目相对正斜线路径。通过 realpath 检查最近存在的祖先，配置目录经符号链接或 junction 指向项目外也拒绝；返回配置及 paths 冻结，不创建目录（特别是可选 account）。错误含 jingchuanchu.json 路径及字段；生成器实际写入时仍需按 T33 的写前预检重新确认路径，解析时检查不替代写入事务。

CLI check 先读取此配置，新 application profile 调用 checkApplicationProject，再编译 src 与已存在自定义业务目录中的组件资源；缺失可选目录不创建也不检查，已存在目录内缺失配套资源仍正常报错。模板 scripts/check-project.mjs 通过 tooling/project 同一检查器分流 application，legacy 分支继续原有目录/HTML/CSS Module 等检查；因此新业务无需保留旧 src/ui/components 布局。完整 TS 检查仍由项目 tsc 命令执行，目录/资源检查不能代替全量类型或构建成功。

checkApplicationProject(configuration) 扫描已有 src/配置 paths 文件，业务名采用 kebab-case，不要求创建空目录。app 装配 pages/game/components/themes/account；pages 访问游戏能力与公共组件；公共 components 不导入 app/pages/game/account 内部，game 只依赖游戏域和公共资产，不导入 DOM/app/pages。TS import/reexport/静态动态 import 使用 tsconfig aliases 解析后检查；缺失依赖与动态构造路径报原文件及行号。公共 UI 直接导入、再导出或通过 namespace/dynamic import 获取 core.Engine 被拒绝；普通组件仍可使用公开应用能力。引擎 packages/src/dist 内部路径诊断保留。样式允许普通 CSS/Less 与正常共享样式导入，不套旧 CSS Module 全局选择器约束，三文件资源/模板类型检查交由现有 compileViews；此检查器不预先要求尚未生成的 app-shell 等应用文件存在。


```bash
jingchuanchu create ./my-game --preset singleplayer --style less --bundle /path/to/bundle
jingchuanchu generate page play --route /play/:levelId
jingchuanchu generate component hud --page play
jingchuanchu generate component icon-button --shared
jingchuanchu generate scene play --page play
jingchuanchu generate store game --domain session
jingchuanchu generate theme forest --extends default
jingchuanchu add --modules assets,net --bundle /path/to/bundle
jingchuanchu add --all --bundle /path/to/bundle
jingchuanchu check
```

上方命令中，当前 application profile 已接受 generate component name --shared 或 --page pageName，以及 generate page name --route /path（均支持 --project/--style）；scene/store/theme 也已接受下述作用域/继承参数，add --modules/--all --bundle 已可执行且最小真实 tgz 夹具安装通过；引擎本体独立分发仍待 T36。create 的 core/singleplayer/client/server 名称保持；core/server 不生成 UI，默认单机不生成账号目录。既有 generate view/scene 和 check 命令继续识别旧项目；新模型以 component/page 等命令表达职责。

当前 application 组件生成读取统一配置，shared 写 paths.components/name/name.ts/html/css|less；私有写 paths.pages/page/name/name.ts/html/css|less，要求 page/page-page.ts 已存在。定义导入 application.defineComponent，导出 PascalCase 名称，不改根模板、页面入口或路由。style 默认项目配置，可单次覆盖；名称拒绝目录穿越及 Windows 保留设备名。view 仅用于 legacy；scene 按 profile 生成旧 defineScene 或新 defineGameScene，legacy 拒绝新版 page/shared/route/domain/extends 参数；浏览器 create 默认切到 application，旧浏览器布局需显式 --profile legacy-v0.4；core/server 默认仍无 UI。

组件多文件事务先检查 TS/HTML/CSS/Less 同名冲突，再写任何文件；即使生成 Less，已有同名 CSS 也拒绝。每个目标和目录在写前重新检查 realpath 归属，子目录 junction 不能逃出项目。wx 打开句柄后立即登记本次新建文件，写入异常时尝试删除本次文件并仅回收本次创建的空目录；不改已有业务文件。当前定向验证覆盖预检冲突零部分文件、真实 junction 拒绝、CSS/Less 编译与 legacy 回归；页面注册还实测只读注册表写入失败后回收本次新页面/空目录且原注册表保留。未模拟磁盘耗尽导致的部分字节写入。

当前 createProject/CLI create 的 singleplayer/client 默认 application，输出 schemaVersion:2/profile/paths、AppShell 三文件、app-config/app-routes、动态首页三文件、main、全局 CSS/Less、Vite/TS 配置和检查/构建命令。它是最小应用骨架，不是后续默认参考游戏。client 只额外加入 net 依赖，不创建未配置后端的自动连接；单机不创建 account/旧 ui 或空 game/themes 目录。core/server 继续原无 UI 入口，拒绝 application profile；显式 --profile legacy-v0.4 保留旧四预设/生成模型。

新项目 tooling 放 devDependencies，不自动 npm install。--bundle 复用已有摘要/内部依赖闭包解析，复制已校验字节到 vendor；完整 add/独立消费验收仍留 T35/T36。当前 new create→generate page/component→CLI check/TS 的实际验证临时使用仓库 source 条件，Less Vite 验证用源码插件、禁用 fixture 外的配置，产出两个动态页面 chunk；未据此宣称默认 npm 0.4 包包含新 application 入口。生成 README 明确需要配套源码构建套件/工具，独立包验证前不能把标准 npm install/build 当已通过。

当前 generate page name --route /absolute/:param 写入 paths.pages/name/name-page.ts/html/css|less，导出 NamePage；不生成 play.page.ts。注册目标为 paths.app/app-routes.ts，新增命名路由使用 loadPage:()=>import(relative-page-path).then(module=>module.NamePage)，不加静态页面 import，也不自动插入账号策略。

注册器通过 TS AST 识别 application 子入口导入的 defineRoutes（含命名别名），仅接受唯一顶层 const 调用，以及直接静态数组或顶层 const 数组引用（含 as const/satisfies）。递归检查静态 children 的全路径/参数模式与 name，重复名称或等价参数模式先拒绝；动态构造、spread、未知 path/name/children、错误来源同名函数、多个路由声明均提供文件名和可手动添加的记录，不执行项目模块，也不写页面文件。注释保留；三文件和另一种样式冲突全部预检后再写。

页面文件写完才更新已读取的注册表，更新前再次验证原文未变；失败回收本次文件与目录，已改动注册表则尝试恢复原文，未改动时不做重复恢复。当前实际检查包括静态别名/声明引用、实际匹配器解析生成路由、嵌套冲突/动态拒绝、文件冲突与只读注册表故障；尚未验证完整新项目独立构建/页面 chunk 分发（对应后续任务）。

当前 generate scene name --page pageName 生成 paths.pages/pageName/name-scene.ts、PascalCase NameScene 与 defineGameScene，要求所属 page-page.ts 存在；文件说明 GameCanvas.scene 引用输入接入位置，不修改页面或启动帧循环。generate store name --domain domainName 写 paths.game/domainName/name-store.ts，导出 NameStore（defineStore+signal，最小 count/increment 可直接通过 context.useStore 使用），不要求中心全局 AppState 或自动注册服务。

generate theme name 写 paths.themes/name/name-theme.ts，定义基础 background/text/accent token；--extends baseName 必须找到同配置 themes 根下的 baseName/baseName-theme.ts 及约定命名导出 BaseNameTheme，生成 extendTheme 的空覆盖入口供业务编辑。拒绝自继承、缺基础定义/命名导出。派生默认保留基础值，不自动改 app-config 或当前主题。主题图像语义仍按运行时 themes 规格显式填写，不生成虚假素材或账号目录。

scene 要求 --page，store 要求 --domain；theme 的 --extends 可选，未提供即基础定义。各命令只接受其有职责的参数，不能将 --style/--page 等无关参数静默用于别种生成。所有目标复用 T33 的路径复查与冲突预检/新文件事务；只有页面注册会修改已有路由表，这三类不改现有业务文件。实际定向检查导入生成场景/Store/基础与派生主题，通过公开应用实例执行 Store increment/reset，验证主题继承、应用/页面入口不变，源码 CLI/TS 及缺失/冲突诊断通过；未验证浏览器游玩或已发布包消费。

组件目标必须明确为 --page 或 --shared，不能猜全局挂载位置；页面自动注册到配置的路由表，以动态加载器为默认。生成普通组件只生成定义与三文件，不擅自追加到根模板；场景写入所属页并给出明确接入点，不自动启动。主题生成覆盖定义，不自动更换当前主题。

注册表使用可静态修改的 defineRoutes 数组/项目声明引用。若项目采用无法安全分析的动态构造，给出目标文件和手动接入步骤；不以正则搜索一个碰巧叫 GameApp 的标识符替代项目模型。多文件写入前完整预检，同名文件/路由冲突时不部分修改；写入失败回滚本次新增和变更。

## 安装与构建

create/add --bundle 校验清单、tgz 摘要并解析全部内部依赖闭包，将选中包保存 vendor，更新相对 file: 依赖。清单拒绝重复包/附件、非法名字/文件名/摘要和缺失依赖；内部范围按套件约定支持固定版本或 ^目标版本，循环/版本不匹配在写入前拒绝。tooling 放 devDependencies；--all 明确包括服务端运行包和开发工具。create 与 add 共用 resolveBundleModules，实际写入使用已校验字节。

add --modules name[,name] 与 --all 必须二选一并提供 --bundle，可对普通 package.json 项目使用 --project。保留无关依赖、业务文件、现有 package-lock；jingchuanchu-packages.json（schemaVersion:1）记录每个包的版本、vendor 文件和摘要。已有 vendor 只有摘要一致才重用，冲突拒绝；重复调用无变化时不重写。事务复用新文件/元数据回滚，实际只读 package.json 故障已验证不留新增附件或记录。命令不自动安装，明确提示 npm install 更新锁文件；未手工修改锁文件内部结构。

T35 自动项已验证：模拟字节用于摘要/冲突/事务；另外用 npm pack --offline --ignore-scripts 生成六个真实最小 ESM tgz（含内部依赖与 tooling/服务端），分别 add 指定/全部后在临时项目 npm install。只复制 vendor、package.json、package-lock.json 到新目录，以新空 cache 执行 npm ci --offline --ignore-scripts，运行 Node 导入确认依赖实际来自本地附件，锁文件不变、resolved 均为 file:vendor 相对路径。夹具安装脚本特意会失败，实际忽略执行；所有 npm 缓存也在临时目录，不安装到用户工程，不访问外部 registry。

此为无外部依赖的最小真实 tgz 夹具验证，不代表引擎本体及 Vite/Less/TS 等外部开发依赖能凭 vendor 完全离线安装；引擎新 application 入口及实际套件独立消费属于 T36。依赖 registry/cache 的实际边界须在该任务交付时如实列出。

新项目 check 统一执行配置/目录依赖检查、组件/模板类型诊断、主题和路由静态诊断及 TS 检查。结构检查读取 profile/paths，不继续硬编码 src/ui/components、CSS Module 或全局 AppState。业务命名 kebab-case、组件三文件同主名；允许 CSS/Less 和正常共享样式导入。

组件编译器同时识别新 defineComponent/definePage 和旧 defineView。新模型生成虚拟 TS 与源码映射；资源缺失、同名 CSS/Less 歧义、无效绑定必须指向业务文件。配套文件和 Less 导入参与监听；先保留明确的整页重载策略，不宣称已具备保留状态 HMR 或语言服务插件。

打包保留 ESM/声明/source 条件和现有 API；新 application 子入口可被独立 TS 消费。完整套件附 SPEC、开发手册和任务文档，内部链接有效；Windows tar 使用相对归档路径，发布附件不因本地构建自动覆盖远端。

## 直接验收

J1：CSS/Less 新单机项目生成后 check/build 通过，运行时不依赖仓库绝对路径；四类预设保持对应边界。

J2：page/component/scene/store/theme 进入正确业务目录，冲突/分析失败不留半修改，旧项目生成例仍可使用。

J3：add 指定/全部模块补齐依赖并正确区分开发包；vendor+锁文件可独立安装。

J4：模板类型错误、主题键错误、路由冲突和资源错误指向原文件；实际构建可见页面分块。

测试：tests/scaffold.test.ts、tests/component-template.test.ts、tests/project-structure.test.ts；独立 tgz 消费使用扩展后的 scripts/verify-app-suite.ts。包装与独立消费只在此阶段验证，不每个信号改动都重跑。


T36 自动项完成：tooling/project 的 types/default 已统一指向 dist，source 条件保留源码路径；实际包构建产出 application.js/application.d.ts、运行模块和工具检查器。旧 API 名称检查保留 118 个历史公开名称与全部 0.3.0 入口。十个本地 tgz 已生成，归档中 app/tooling 的默认导出文件存在。pack 跳过生命周期脚本，Windows 由 Node 直启 npm-cli，避免 shell 参数转义；旧 verify-app-suite 消费者已显式 legacy。

独立消费命令为 npm run test:app:package（先完成当前 build:packages 与 pack:packages），运行 scripts/verify-application-package.ts。脚本从现有真实引擎 tgz 构造临时清单，安装实际 tooling，使用已安装 CLI 创建 application 和显式 legacy 浏览器项目。新版实际生成 page/component/scene/store/基础与派生 theme，执行默认项目 check/tsc/Vite build，不加 source/customConditions 或仓库绝对路径；运行时解析明确落在临时 node_modules/dist，Vite manifest 确认两个动态页面 chunk。将组件模板改成未知字段后，已安装 CLI 拒绝且定位 hud.html:1，随后恢复；legacy 默认 build 同样通过，内部包的 lock resolved 均为 file:vendor，无 server-only ws。

实际报告保存在 dist/audit/application-package-report.json；临时消费工程完成后清理。安装带 --ignore-scripts/--prefer-offline，外部 TypeScript/Vite/Less 等可能使用已有缓存或缺失时访问 registry，不能据此声称整个真实工具链可全离线安装。脚本没有浏览器/设备操作，不创建 Release、发布 npm 或改变标签。完整默认参考游戏与 Release 套件流程仍留 T37—T44。


T37 兼容准备：legacy 浏览器 starter 已隔离到 templates/legacy-browser；显式 legacy 创建从 starters/legacy-browser（源码回退同名模板目录）读取。tooling 构建携带两套独立目录，构建脚本可传完整包名定向构建、不传仍全量；实际仅构建 tooling 后验证其编译 createProject 能读取旧 starter，不重复未改运行包构建。当前已打包 tgz 是 T36 检查时产物，后续包含这项隔离的新套件需在交付批次重打；此处未重复打包或发布。


T44 模板统一子步骤：application 创建已复用完整 templates/browser，tooling 构建复制为 dist/starters/browser，创建时只调整项目/版本/预设/样式/vendor元数据，移除另一份手写最小应用壳。二进制素材按原字节复制，Less只变更样式文件名及其文本导入。默认项目自带完整页面、主题、声音和保存流程及媒体许可；新增业务生成使用bonus/score/custom等未占用名称。显式legacy仍使用独立旧模板。音效配方随项目scripts分发，旧仓库生成入口转发至同一实现。

完整CSS/Less创建/生成/CLI/类型与Less静态拆块检查5/5，旧结构规则6/6；built tooling创建并检查完整Less项目通过。后续实际tgz与隔离套件验证已完成，见下文。全部检查不启动浏览器。


T44 自动交付项完成：实际打包tooling在仓库外生成完整CSS/Less与legacy项目，安装/check/build通过；现代项目各6个动态页面块、三份WAV和MIT许可复制、模板错误定位及新旧ESM入口消费通过。生成项目无source条件，内部依赖使用vendor相对file引用；npm隐藏.gitignore问题已通过可打包资源名恢复原文件名，并经真实tgz验证。

本地隔离套件Node验证通过，包含归档/摘要/许可/文档、选择安装、starter离线构建及示例；构建补齐内部依赖闭包，防止starter访问未发布内部包的registry。Windows tar以basename/cwd避免盘符远端解析并规范CRLF文本比较，npm使用当前Node的CLI。支持build --output-dir与verify --archive以保留既有本地分发目录。测试始终--skip-browser，真实浏览器/设备仍未验收；本次未发布、推送或移动标签。新入口使用与迁移见 [应用指南](../development/application-framework.md)。
