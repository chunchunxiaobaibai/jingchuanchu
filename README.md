# 镜川初 · Jingchuanchu Engine

面向网页 2D 游戏的 TypeScript ECS 引擎。当前源码提供页面、三文件组件、响应式状态、Store、路由、主题、Canvas 场景、音频与保存恢复，并附带可独立创建的收集小游戏。玩法保存在游戏项目，引擎提供运行与开发能力。采用 [MIT](LICENSE) 授权。

本文面向**当前源码**。当前预发布版本为 0.5.0-rc.1，但新入口 `@xiaobaibaifqy/jingchuanchu-app/application` 需要由这份源码构建的配套包；历史 v0.4.0 附件和同版本号不能证明包含该入口。本版本按预发布交付；历史 Release 保留，npm 未发布。历史根入口 defineGame/defineView 的用法见 [旧应用套件手册](docs/development/application-suite.md)。

预构建套件入口：[v0.5.0-rc.1 预发布](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.5.0-rc.1)。下载 ZIP/tar.gz 与 SHA-256 后按 [快速入门](docs/development/getting-started.md) 使用；浏览器/设备/性能仍按预发布边界验收。

## 创建并运行游戏

准备 Node.js >=22.12.0、npm 和 tar；在 Windows 或 WSL 中选择一个平台安装依赖。取得包含 application 入口的源码后，在引擎根目录运行：

```bash
npm ci
npm run dist:release
node packages/tooling/dist/cli.mjs create ../my-game --bundle ./dist/releases/jingchuanchu-engine-0.5.0-rc.1
cd ../my-game
npm install
npm run check
npm run build
npm run dev
```

dist:release 仅生成本地套件。CLI 将所需引擎包及内部依赖复制到游戏的 vendor，不自动安装依赖或启动服务。Vite 的访问地址以终端输出为准；当前新模板没有固定端口配置。引擎仓库本身没有根目录 dev 入口。

只有配套套件时，使用 [快速入门](docs/development/getting-started.md) 中的“从套件创建”流程；现有项目按需接入模块见 [分发与安装](docs/development/distribution.md)。registry 或历史附件中的旧包不能替代这份源码构建的 application 包。

默认项目包含首页昵称、选关、游玩、暂停/重开、设置、结算、音频试听、两套开发者主题和白名单存档。创建时加 --style less 使用 Less；--preset client 只额外提供网络依赖，连接仍需业务配置。旧布局使用 --profile legacy-v0.4。core/server 预设保持无 UI 入口。

## 开发自己的功能

在生成的游戏目录执行：

```bash
npm run generate -- page bonus --route /bonus
npm run generate -- component score-editor --shared
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme forest --extends default
```

页面生成会注册路由；组件需要在父定义的 components 和 HTML 中引用，场景显式交给 GameCanvas，主题在应用配置中选择。已有文件或路由冲突不会被覆盖。默认模板已有 play、game、default 等定义，新增业务应选择新名称。

| 需要做什么                       | 阅读入口                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| 创建项目、启动、构建网页         | [快速入门](docs/development/getting-started.md)                                               |
| 理解目录、CLI、配置、迁移        | [应用开发总览](docs/development/application-framework.md)                                     |
| 编写组件、表单、Store 和页面路由 | [组件与页面教程](docs/development/application-components.md)                                  |
| 编写场景、动作、暂停和计时       | [2D 场景与游戏能力](docs/development/application-gameplay.md)                                 |
| 接入素材、主题、音频、保存和认证 | [资源与应用服务](docs/development/application-services.md)                                    |
| 查询 application 的公开 API      | [应用 API 索引](docs/development/application-api.md)                                          |
| 直接使用 ECS、内核与基础包       | [ECS 与循环](docs/development/ecs-and-loop.md)、[底层 API](docs/development/api-reference.md) |
| 定位错误与准备验收               | [常见问题](docs/development/troubleshooting.md)、[验收清单](tasks/acceptance.md)              |

完整导航见 [开发手册](docs/development/README.md)。

## 模块与边界

完整包名前缀为 @xiaobaibaifqy/jingchuanchu-，共 10 个包：

| 后缀             | 职责                                                |
| ---------------- | --------------------------------------------------- |
| ecs              | 实体、组件、查询、资源与延迟命令                    |
| core             | 固定步、系统、模块依赖、事件与 Scope                |
| browser          | 帧驱动、可见性与暂停恢复                            |
| renderer-2d      | Canvas 2D、精灵/动画、坐标、基础碰撞                |
| input            | 底层键盘、指针与捕获清理                            |
| assets           | 共享加载缓存与释放                                  |
| net / net-server | 网络连接、消息/房间基础与 Node WebSocket            |
| app              | 旧根入口及新增 application 应用模型                 |
| tooling          | CLI、模板诊断、三文件编译与 Vite 插件，仅开发期使用 |

运行包除 net-server 的 ws 外无第三方运行依赖；工具链依赖放在 tooling 中。引擎不包含 3D、编辑器、完整刚体物理、账号数据库或通用游戏同步协议。认证是可选 Provider/权限接入能力。浏览器需要 ES2022、Canvas 2D、Pointer Events 和 requestAnimationFrame；包为 ESM。

## 维护与交付

按改动选择检查，文档修改只需静态检查。常用命令：

| 命令（引擎根目录）                             | 作用                                          |
| ---------------------------------------------- | --------------------------------------------- |
| npm run typecheck                              | 类型检查                                      |
| npm run check:templates / npm run test:project | 默认模板静态检查 / 定向项目检查               |
| npm run build                                  | 类型检查并构建各包                            |
| npm run pack:packages                          | 构建并生成 dist/packages 中的 tgz             |
| npm run dist:release                           | 生成本地套件与归档，不上传                    |
| npm run test:app:distribution                  | 消费已生成 tgz，验证独立 CSS/Less/legacy 项目 |
| npm run test:distribution:node                 | 重建套件并验证 Node 分发流程，跳过浏览器      |

test:2d 和 test:distribution 会启动浏览器，仅在明确安排浏览器验证时使用。Node DOM、注入驱动与静态构建不代表真实游玩、设备音频或性能通过。当前修复与未执行的人工项见 [验收记录](tasks/acceptance.md)；实施状态见 [todo](tasks/todo.md)。

新能力规格入口为 [SPEC](SPEC.md)，执行顺序见 [plan](tasks/plan.md)。源码、历史附件与生成的包必须明确区分；修改源码后需重新构建才会进入 vendor/tgz。外部项目保存源码、vendor、package.json、锁文件和素材许可，部署的是游戏自己的 dist。

[仓库](https://github.com/chunchunxiaobaibai/jingchuanchu) · [问题反馈](https://github.com/chunchunxiaobaibai/jingchuanchu/issues) · [贡献指南](CONTRIBUTING.md) · [源码构建](docs/development/build-from-source.md) · [发布维护](docs/maintainers/github-delivery.md)
