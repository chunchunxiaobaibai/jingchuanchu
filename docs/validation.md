# 验证记录

## 2026-10-28：0.5.0-rc.1 GitHub 预发布

本次用户明确授权上传 GitHub 与创建 Release，统一根包及 10 个工作区包为 0.5.0-rc.1。使用新增标签/预发布，不移动 v0.4.0、不替换历史附件，不发布 npm。

实际验证：

- 严格 TypeScript 检查通过，10 个新版本 tgz 已构建；默认模板结构/绑定/类型检查通过。
- Node 用例覆盖 349 项。Windows Node 24.21.0 主批次 348 项通过；1 项分发安装测试因该便携 Node 没有相邻 npm-cli.js 失败，改用附带 npm 的 Windows Node 24.12.0 定向重跑后通过。该失败属于验证宿主，不作为功能失败或跳过计数。
- 实际 10 份 tgz 在仓库外验证通过：CSS、Less 和显式 legacy 项目创建/安装/check/类型/Vite build；现代项目各 6 个懒页面分块、3 份 WAV、许可复制、原模板错误位置与 vendor 相对依赖通过，无 source 条件、不带 ws。
- 独立基础包消费者通过：ecs/core，以及 ecs/core/browser/input/renderer-2d/assets。
- 完整 Node 分发检查通过：归档/许可/文档链接/摘要、按需安装及失败保护、无界面示例、离线 starter 静态构建与真实本地网络往返。显式 --skip-browser，不加载/启动浏览器分支。
- 原有 118 个 API 名称及全部 0.3.0 入口兼容检查通过。

完整参考模板的诊断加 Vite 构建在当前机器超过原验证脚本的 45 秒短操作上限；仅将构建步骤上限调整为 180 秒，并给临时目录清理增加有限重试。原始失败报告保留了超时来源，调整后 CSS/Less/legacy 全部实际通过，未放松断言。

当前发布产物在干净源码提交与 v0.5.0-rc.1 标签上最终装配；tar.gz、ZIP 来自同一目录，分别附 SHA-256。manifest 记录最终 revision/tag，sourceDirty=false。源码、包和远端附件的核对记录保存在本地 dist/audit/release-0.5.0-rc.1（不提交的审计产物）。

未验证：H01—H04 真实浏览器游玩、IME/焦点/触控/历史、设备音频/后台恢复与性能。没有启动浏览器、Playwright、截图或宣称最低支持版本/全部设备矩阵通过。预发布说明保留这些限制，使用和迁移见 [开发手册](development/README.md)、[本版本说明](maintainers/release-0.5.0-rc.1.md) 与 [验收清单](../tasks/acceptance.md)。

## 0.4.0 本地交付

当前 0.4.0 未发布 npm，通过本地 tgz 或完整分发套件使用；公共 npm 保留 0.3.0。

2026-10-14，发布准备阶段已完成：

- 严格类型检查、8 个包构建和 37 项引擎测试通过。
- 独立 tgz 消费验证通过：内核及网页单机组合可独立安装、严格 TS 编译并执行，未安装未选择的网络依赖。
- 格式检查与 8 个包的 npm publish dry-run 通过；没有正式上传任何 0.4.0 包。

本次仓库清理保留引擎源码、测试、构建/分发工具、开发文档、最小示例与浏览器模板，删除历史游戏、临时产物和过时整理文档。引擎实现及公开 API 未改动。性能测量证据保留在 [测量报告](performance/README.md)。

清理后的检查通过：

- `npm run dist:release`：类型检查、8 包构建/打包和完整交付归档生成。
- 归档 SHA-256 与分发文档的相对链接检查。
- Windows 临时独立项目通过安装器安装 core、singleplayer、server；消费代码严格 TS 编译、内核执行和所选模块导入通过，未选服务端的组合不安装 ws。
- core 和 singleplayer 使用离线安装；server 正常联网获取 ws。未缓存 ws 元数据时，server 的离线安装会失败。
- 内核 tgz 复制到项目 vendor 后，以相对路径安装、离线 `npm ci` 和消费代码执行通过。

完整非浏览器分发检查命令为 `npm run test:distribution:node`，独立包检查为 `npm run test:packages`。这些命令按需要选择，不是每次编辑的固定全量流程。

## 2026-10-15：原生 TS 项目约束

模板重构为 app/contracts/game/ui/styles，组件使用同名 HTML、TS 和 CSS Modules；新增 AST/HTML/CSS 结构检查，接入模板 check/build 及分发生成流程。

- 新增的 6 项定向检查通过：合法结构、跨层导入及别名/动态导入、游戏层 DOM、内联代码、组件样式越界、目录/配套文件，以及场景移动、暂停、目标输入与清理。
- 根类型检查与模板结构/类型检查通过。
- `npm run dist:release` 通过；`npm run test:template` 在临时外部项目安装本地 tgz、执行模板 check/build，通过结构检查、TS 编译和 Vite 静态构建，未引入 ws。
- 新增解析器仅是开发工具依赖，没有改变引擎运行包与公开 API。未发布 npm，也未迁移或替换 my-game 的现有分发副本。

## 浏览器验证范围

本次未启动浏览器、Playwright 或 Chromium。模板的实际交互、页面视觉及游戏集成留给使用者验证；已有历史浏览器测量不能作为本次检查通过的证据。约定见根目录 AGENTS.md。

## 2026-10-16 应用开发套件

新增 app/tooling，已通过 13 项 Node DOM 的运行时/编译/生成器针对性检查、严格类型检查（含预期失败的命令、子组件输入和只读状态类型案例）、项目结构与旧模板场景回归。核心、场景、模块与包边界 19 项通过，原有 API 名称/入口 118 项兼容检查通过。

独立 tgz CLI 验证创建 core、server、singleplayer CSS、singleplayer Less、client CSS 项目，自动生成 UI/场景并静态构建；Less 验证共享变量导入。core/server 先通过，修复打包模板复制过滤后其余三个浏览器预设均通过。未启动浏览器或实际游戏服务器，不把静态构建等同于交互/网络/画面验收。
