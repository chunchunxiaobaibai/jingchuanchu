# 镜川初接手记录

## 2026-11-02 当前状态

- 当前分支为 `dev`，本次同步前的提交基线为 `5776288`。用户已明确授权更新并推送 GitHub；本次将文档/脚本迁移、浏览器启动修复、P01—P06 性能优化和测量记录一起纳入仓库提交，不创建 Release、不发布 npm、不移动标签。
- 性能规格见 [performance-spec](performance-spec.md)，执行顺序见 [plan](plan.md)，P01—P06 实际结果见 [todo](todo.md) 和 [迭代报告](../artifacts/performance/iterations/README.md)。保留现有引擎架构与公开 API。
- 最终运行时验证为 48/48 组合定向测试、类型检查及 118 个原公开名称/入口检查通过；Node 热路径/原生对照和生产 Chrome 像素/参考游戏采样已执行。完整设备、长时间内存与 H01—H04 全流程仍未验收。
- GitHub 同步前已重新生成 HTML 手册，更新受源码位置变化影响的 API/搜索产物；docs:check 通过：50 页、3407 个本地链接、605 条搜索记录、326 项公开导出。未重新执行完整分发构建或包发布验证。

## 2026-10-29 历史快照

下文保留当时的交接背景，其中“本轮”、未提交状态与授权描述均指 2026-10-29，不覆盖上方当前状态。

更新日期：2026-10-29（Asia/Shanghai）。本文件是当前工作区的交接快照；规格以 [SPEC](../SPEC.md) 为入口，执行顺序见 [plan](plan.md)，完成状态见 [todo](todo.md)。

## 当前基线与本轮范围

- 仓库：`/mnt/d/codexproject/xiaobaifqy-engine`；分支：`dev`；HEAD：`5776288`（`feat: release 0.5.0-rc.1 web 2D application framework`）。根包版本为 `0.5.0-rc.1`。
- 工作区存在大量未提交修改、删除和未跟踪文件，主要来自 2026-10-29 的手册迁移及脚本目录重组。仅检出 HEAD 不能重建当前交付内容；接手时先查看 `git status --short` 和实际文件，不重置或清理这些改动。
- 本轮用户请求是“编写 handoff”。本轮仅新增此文档，不修改现有实现或替用户提交、推送、发布。
- 历史任务记录包含 GitHub 预发布授权与交付记录；本轮未查询远端，不据此认定当前工作区已经发布，也不把历史授权扩展到新发布。

## 已完成内容

### 应用框架与参考模板

[todo](todo.md) 记录 T01—T44 自动实施完成，包含响应式、组件/模板、Store、应用作用域、路由、主题资源、Canvas、输入、音频、保存、可选认证/权限、CLI 与完整参考游戏模板。A01/A02 已修复并有直接回归证据，详情见 [验收记录](acceptance.md)。

- 新模型入口：`@xiaobaibaifqy/jingchuanchu-app/application`，源码在 `packages/app/application.ts`、`packages/app/runtime/`。
- 默认应用模板：`templates/browser/`；显式旧模型模板：`templates/legacy-browser/`。保留既有公开入口、函数名和包名，新模型通过新增入口及显式迁移使用。
- 引擎源码在 `packages/`，业务玩法留在模板/示例；当前范围仅为网页 2D。

### 当前未提交的手册与目录整理

- 开发手册集中在 [HTML 文档站](../docs/index.html)，分为指南、API、工程维护和 16 个模块契约。当前记录为 50 页、10 个包的 21 个入口、326 项公开导出。
- 旧 `docs/development/*.md`、`docs/specs/*.md`、维护/性能等 Markdown 文档已在工作区删除或归并；模块规格链接现在指向 `docs/specs/*.html`。根 README、包/模板/示例 README 已收敛为入口与必要运行说明。
- `scripts/` 已按 `build/`、`verify/`、`benchmarks/`、`assets/`、`docs/`、`distribution/` 分类，`package.json` 命令同步使用新路径。
- 分发说明源为 [readme.html](../scripts/distribution/readme.html)；分发构建改为携带 `README.html` 与独立 HTML 手册，验证脚本增加套件手册检查。完整分发尚未在此次重组后重建验证。
- 新增目录与 HTML 文件目前仍含未跟踪内容；保存或提交时必须连同旧文件删除和脚本引用变更一起审查，避免只保存已跟踪 diff。

## 文档维护入口

| 内容                   | 位置与维护方式                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| 手册正文               | `docs/guide/`、`docs/engineering/`、`docs/specs/` 等页面中的 `article[data-doc-content]` |
| 页面登记               | `scripts/docs/pages.json`                                                                |
| 公共页面壳、导航及构建 | `scripts/docs/site.mjs`                                                                  |
| API 提取与生成         | `scripts/docs/api.mjs`；从当前包公开入口提取，不直接修改生成的 API 清单                  |
| 样式、交互与搜索产物   | `docs/assets/`；搜索索引随文档构建更新                                                   |
| 静态检查、本机服务     | `scripts/docs/check.mjs`、`scripts/docs/serve.mjs`                                       |

正文、导航或 API 变动后，按影响执行 `npm run docs:build` 与 `npm run docs:check`。构建会更新公共页面壳、API 和搜索产物，需一并查看 diff。`npm run docs:dev` 用于手动访问文档；不自动打开浏览器。当前手册面向 PC，未增加移动端适配。

## 验证证据与边界

以下历史结果来自仓库记录，本轮未重跑，不作为本轮新增验证：

- 发布阶段：[todo](todo.md) 与 [验证记录](../docs/engineering/validation.html) 记载 349 项 Node 用例、类型/模板、10 包构建、CSS/Less/legacy 实际 tgz 消费、独立基础包及 Node 分发/API 名称检查完成。其中一项宿主缺 npm 的用例换匹配 Node 后定向重跑通过。
- 2026-10-29 手册整理：todo 记载 `npm run typecheck`、`npm run docs:build`、`npm run docs:check` 通过；当时为 50 页、3407 个本地链接、605 条搜索记录、326 项 API。另记载格式/JS 语法、CSS/PC 布局静态、Node DOM 交互、本机 HTTP、独立临时复制手册及分发 README 检查通过。
- 此次目录重组后未执行完整 `dist:release`、全量测试或真实浏览器/设备/视觉验收。已有旧套件不能证明当前 `README.html` 分发改动通过。
- 本轮仅对新增 handoff 做 Markdown 格式、本地链接存在性和差异空白检查，结果随本轮交付说明记录。没有新增功能测试。

## 未完成事项与已知限制

| 项目 | 当前状态及接手依据                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| H01  | 完整游玩、加载失败/坏档恢复、暂停/结算/重开未实际验收                                                               |
| H02  | 输入法、焦点/光标、触控坐标、历史导航及往返缓存未实际验收                                                           |
| H03  | 真正的音频解锁、后台恢复、主题画面及反复进出资源表现未实际验收                                                      |
| H04  | 按实际性能问题或交付需要测量；目前不能给出性能结论                                                                  |
| DX01 | 生命周期钩子写在 setup 前可能使 exposed 推断为 `{}`；当前先写 setup 或使用完整显式泛型                              |
| DX02 | 内联 routes 的 guards 返回对象可能扩大为 `status: string`；当前显式标注 `GuardResult` 或先用 `defineRoutes`         |
| DX03 | `defineApplication.inputs` 按数据 snapshot 处理，不能直接传含函数的根引用输入；当前在根 setup 暴露引用给 GameCanvas |

H 项步骤、预期与未执行状态见 [验收清单](acceptance.md)。Node DOM、静态构建和 HTTP 检查均不代表真实浏览器、设备或实际游玩通过；当前不能宣称整体验收完成。

已知文档残留：`tasks/acceptance.md` 末段仍有纯文本旧路径 `docs/validation.md`，当前对应页面为 `docs/engineering/validation.html`。接手如做文档清理可同步修正；本轮没有修改原记录。

## 接手顺序与操作约束

1. 阅读 [工作约定](../AGENTS.md)、SPEC、todo 最后一次更新及本文件，再核对工作区。当前用户没有指定新功能任务，不从已完成的 T 项重新开始。
2. 若继续文档整理，修改对应 HTML 内容或生成器，只执行受影响的静态检查；已通过且未受影响的检查不反复运行。
3. 若用户要求验证本次分发改动，使用 `npm run test:distribution:node`，它会先执行完整 `dist:release`；独立包消费按需使用 `npm run test:packages`。这些命令会构建产物，不是纯文档检查。
4. 若用户要求浏览器或设备验收，按明确授权范围执行 H 项并记录平台、步骤和结果。`npm run test:2d` 与 `npm run test:distribution` 会启动浏览器，不默认执行；不自动启动 Playwright/Chromium、操作页面或截图。
5. 不因本文件自行提交、推送 GitHub、创建 Release、发布 npm、移动标签或替换历史附件。新增任务按 SPEC/plan/todo 更新对应状态，交付说明列出实际检查和未验证部分。

运行环境要求以根 `package.json` 为准（Node `>=22.12.0`）。本轮读取到的 shell Node 为 `v26.7.0`；涉及安装或打包时仍需核对 Node/npm 配套及命令路径，不假定与历史验证宿主一致。
