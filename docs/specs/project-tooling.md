# project-tooling：项目、代码生成和构建

公共规则见 [SPEC](../../SPEC.md)。位置：packages/tooling 与模板检查脚本；不把 Vite、Less、TS 编译器变成核心引擎运行依赖。

## 项目配置与命令

新 jingchuanchu.json 使用 schemaVersion:2、profile:'application'、preset、style 及 paths（app/pages/game/components/themes/account）。路径相对项目根，默认见 SPEC；禁止指向项目外进行生成写入。缺失新 profile 的现有配置按 legacy-v0.4 解释，不把旧项目当成新布局检查。

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

命令是下一版目标，不表示当前 CLI 已接受这些参数。create 的 core/singleplayer/client/server 名称保持；core/server 不生成 UI，默认单机不生成账号目录。既有 generate view/scene 和 check 命令继续识别旧项目；新模型以 component/page 等命令表达职责。

组件目标必须明确为 --page 或 --shared，不能猜全局挂载位置；页面自动注册到配置的路由表，以动态加载器为默认。生成普通组件只生成定义与三文件，不擅自追加到根模板；场景写入所属页并给出明确接入点，不自动启动。主题生成覆盖定义，不自动更换当前主题。

注册表使用可静态修改的 defineRoutes 数组/项目声明引用。若项目采用无法安全分析的动态构造，给出目标文件和手动接入步骤；不以正则搜索一个碰巧叫 GameApp 的标识符替代项目模型。多文件写入前完整预检，同名文件/路由冲突时不部分修改；写入失败回滚本次新增和变更。

## 安装与构建

create/add --bundle 校验 tgz 摘要并解析全部内部依赖闭包，将选中包保存 vendor，更新相对 file: 依赖。tooling 放 devDependencies；--all 明确包括服务端运行包和开发工具。add 只更新依赖与包记录，不改写已有业务页面。默认不自动 npm install，提供明确后续命令。

新项目 check 统一执行配置/目录依赖检查、组件/模板类型诊断、主题和路由静态诊断及 TS 检查。结构检查读取 profile/paths，不继续硬编码 src/ui/components、CSS Module 或全局 AppState。业务命名 kebab-case、组件三文件同主名；允许 CSS/Less 和正常共享样式导入。

组件编译器同时识别新 defineComponent/definePage 和旧 defineView。新模型生成虚拟 TS 与源码映射；资源缺失、同名 CSS/Less 歧义、无效绑定必须指向业务文件。配套文件和 Less 导入参与监听；先保留明确的整页重载策略，不宣称已具备保留状态 HMR 或语言服务插件。

打包保留 ESM/声明/source 条件和现有 API；新 application 子入口可被独立 TS 消费。完整套件附 SPEC、开发手册和任务文档，内部链接有效；Windows tar 使用相对归档路径，发布附件不因本地构建自动覆盖远端。

## 直接验收

J1：CSS/Less 新单机项目生成后 check/build 通过，运行时不依赖仓库绝对路径；四类预设保持对应边界。

J2：page/component/scene/store/theme 进入正确业务目录，冲突/分析失败不留半修改，旧项目生成例仍可使用。

J3：add 指定/全部模块补齐依赖并正确区分开发包；vendor+锁文件可独立安装。

J4：模板类型错误、主题键错误、路由冲突和资源错误指向原文件；实际构建可见页面分块。

测试：tests/scaffold.test.ts、tests/component-template.test.ts、tests/project-structure.test.ts；独立 tgz 消费使用扩展后的 scripts/verify-app-suite.ts。包装与独立消费只在此阶段验证，不每个信号改动都重跑。
