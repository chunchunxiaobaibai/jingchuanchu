# 小白 TS 2D 引擎

面向浏览器的 TypeScript ECS 引擎。支持按需组合单机与联机能力；引擎包不依赖游戏代码。仓库包含「拾光」单机示例和基础版「你画我猜」联网示例。

## 使用引擎开发自己的游戏

从 [开发手册](docs/development/README.md) 开始，包含快速入门、完整 API、自定义模块、浏览器与网络接入。
可以生成包含 8 个安装包、文档、安装器与可运行 TS 项目的分发套件：

```bash
npm run test:distribution
```

输出在 `dist/releases/xiaobaifqy-engine-0.2.1.tar.gz`，可直接交给其他开发者。采用 [MIT](LICENSE)，尚未上传公共 npm。

## 启动

需要 Node.js 22.12 或更高版本，使用 npm。源代码与测试使用严格 TS，页面结构和样式使用 HTML/CSS。

```bash
npm ci
npm run dev
```

访问 http://localhost:5173 。打开两个标签页，一人创建房间，另一人填写房间码加入，房主开始游戏。单机示例位于 http://localhost:5173/singleplayer/ 。

只启动单机示例，不启动房间服务：

```bash
npm run dev:singleplayer
```

访问 http://localhost:5174 。方向键/WASD 移动，或点击画布指定目的地，收集 5 个金色方块。支持暂停与重新开始。

## 独立包

| 包                     | 职责                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `@xiaobai/ecs`         | 实体、代际 ID、稀疏集、组件查询、世界资源、延迟命令        |
| `@xiaobai/core`        | 固定步长、系统顺序与耗时、模块依赖、事件、作用域、生命周期 |
| `@xiaobai/browser`     | 浏览器帧循环、页面可见性与暂停恢复                         |
| `@xiaobai/renderer-2d` | Canvas 2D、坐标转换、基础图形、笔画                        |
| `@xiaobai/input`       | 键盘状态、指针输入与捕获清理                               |
| `@xiaobai/assets`      | 资源缓存、共享加载、失败重试与释放                         |
| `@xiaobai/net`         | 浏览器连接、消息解码边界、房间目录与限流                   |
| `@xiaobai/net-server`  | Node WebSocket、消息大小限制、心跳与发送积压保护           |

包均提供独立公开入口、ESM、TS 声明和源代码，可打包为本地 tgz。未上传 npm registry。ECS 无其他依赖；外部项目只选择单机组合时不会带入网络包。仓库完整安装包含两个示例的依赖，单机页面不加载网络代码。网络服务端的 `ws` 只在服务端包中，游戏协议的 `zod` 留在游戏层。

安装方法、自定义模块、生命周期与组合示例见 [模块指南](docs/modules.md)。

## 引擎与游戏的边界

```text
apps（页面与服务启动） → games（具体玩法） → @xiaobai/*（引擎）
```

跨引擎包只使用公开包名导入，不访问兄弟目录内部文件。渲染、输入、资源、网络和浏览器运行通过 `EngineModule` 安装：

```ts
import { Engine } from '@xiaobai/core';
import { browserModule } from '@xiaobai/browser';
import { canvas2DModule } from '@xiaobai/renderer-2d/module';
import { keyboardModule } from '@xiaobai/input/module';

const engine = new Engine();
engine.install([canvas2DModule({ canvas }), keyboardModule(), yourGameModule(), browserModule()]);
engine.start();
```

`canvas` 由应用提供，`yourGameModule()` 放在游戏层。内核不认识玩家分数、题目、笔画协议或收集目标。

`Engine.install` 支持分批安装，在启动前或暂停时配置。缺失依赖、循环和重复 ID 会拒绝；本批 setup 失败会反向清理登记的资源，保留已有模块。`Engine.provide` 注册类型化服务，`world.getResource` 获取；`Engine.dispose` 统一释放。

逻辑 `delta` 为秒。默认每秒 30 步，最多补算 5 步。渲染独立运行；组件结构变更可通过 `world.defer` 延迟到步末尾。网络 ID 不复用 ECS 实体 handle。

## 构建与打包

```bash
npm run build
npm start
```

访问 http://localhost:3001 ，单个 Node 服务提供联网网页和 WebSocket，也可展示单机页面。

单机也可以单独构建与预览：

```bash
npm run build:singleplayer
npm run preview:singleplayer
```

访问 http://localhost:4174 ，此时只有静态网页服务，不需要游戏服务器。输出在 `dist/singleplayer`，可用任意静态托管。

```bash
npm run build:packages
npm run pack:packages
```

独立包编译输出在各包 `dist`，tgz 位于 `dist/packages`。根构建会按依赖顺序编译包；外部项目按需安装所选 tgz 与其内部依赖。

## 你画我猜

- 每房间 2–10 人，房主开始，开始时的成员每人绘画一次；新加入的玩家可以猜词，下局参与绘画。
- 每回合 60 秒；超时或所有猜词玩家猜中后揭晓，由房主进入下一回合。
- 首位猜中得 100 分，之后递减 20 分，最低 40 分；每位猜中，绘画者加 25 分。
- 未揭晓答案只发给绘画者，正确猜测记录显示「猜对了！」。
- 笔画增量同步，成员和回合变化同步个性化快照；新加入可恢复画布，序号异常时请求快照。
- 最多 2,000 个笔画片段/20,000 个点，可清空继续绘画。
- 房主离开后转移；绘画者离开结束当前回合；不足 2 人回到等待状态。
- 断线后手动重新连接并加入，作为新玩家进入，不保留旧身份和分数。

`PORT` 配置房间服务端口。开发代理默认使用 3001，改端口时也要调整 `vite.config.ts`。`ALLOWED_ORIGINS` 是逗号分隔的跨域连接白名单，同源自动允许。浏览器使用当前页面地址的 `/ws`，HTTPS 页面使用 WSS。

## 验证

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:packages
npm run format:check
```

单元与真实 WebSocket 测试覆盖内核、规则、模块生命周期和单机逻辑。浏览器测试包含双客户端绘画同步，以及阻断 WebSocket 后仍能运行的单机示例。独立包测试在临时外部项目离线安装包，编译并执行消费代码，检查网络依赖没有被安装。

浏览器测试先构建，并确保 3001 端口空闲；Linux 需安装 Chromium 运行库。本机测试配置使用独立浏览器，不读取个人浏览器配置。

## 当前范围

引擎提供模块化基础，没有编辑器、完整物理或音频模块，也没有异步 setup 和单个模块动态卸载。联网房间仍为单进程内存数据，没有账号、持久化、跨进程匹配；重启服务会清空房间。

架构与验证记录见 [架构说明](docs/architecture.md)、[验证记录](docs/validation.md)，接口迁移见 [更新记录](CHANGELOG.md)。
