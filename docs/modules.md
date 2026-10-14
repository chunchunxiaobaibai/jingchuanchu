# 按需组合引擎

0.4.0 新子入口与可选能力见 [扩展手册](development/extensions-0.4.md)，所有旧入口与函数名保留。

## 包和模块是两个边界

包决定项目引用哪些代码；`EngineModule` 决定实例启用哪些功能。所有包均有 ESM、TS 声明和独立公开入口。仅安装 ECS，不会引入渲染或网络；单机需要的包也不会安装 `ws`、`zod` 或联网游戏规则。

| 包                                        | 普通入口                                    | 模块入口                                           | 内部依赖         |
| ----------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ---------------- |
| `@xiaobaibaifqy/jingchuanchu-ecs`         | World、组件/资源 token                      | 无                                                 | 无               |
| `@xiaobaibaifqy/jingchuanchu-core`        | Engine、Scope、EventBus                     | 自定义 EngineModule 接口                           | ecs              |
| `@xiaobaibaifqy/jingchuanchu-browser`     | runBrowser、BrowserDriver、browserModule    | 同普通入口                                         | core             |
| `@xiaobaibaifqy/jingchuanchu-renderer-2d` | Canvas2D、Position2D、Shape2D               | `/module`：canvas2DModule、Renderer2D              | core、ecs        |
| `@xiaobaibaifqy/jingchuanchu-input`       | KeyboardInput、bindPointer                  | `/module`：keyboardModule、pointerModule、Keyboard | core、ecs        |
| `@xiaobaibaifqy/jingchuanchu-assets`      | AssetCache                                  | `/module`：assetModule                             | core、ecs        |
| `@xiaobaibaifqy/jingchuanchu-net`         | BrowserConnection、RoomDirectory、RateLimit | `/module`：networkModule                           | core、ecs        |
| `@xiaobaibaifqy/jingchuanchu-net-server`  | WebSocketHost                               | 显式异步 close，由服务入口管理                     | net；外部依赖 ws |

普通入口可直接使用，不强制安装到 Engine。模块入口负责注册服务/系统以及清理。浏览器包没有网络依赖；Node WebSocket 实现不会进入浏览器入口。`zod` 仅供当前游戏协议使用。

## 单机组合

```ts
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { browserModule } from '@xiaobaibaifqy/jingchuanchu-browser';
import { canvas2DModule } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';
import { keyboardModule } from '@xiaobaibaifqy/jingchuanchu-input/module';
import { collectorModule } from './my-game.js';

const engine = new Engine();
engine.install([canvas2DModule({ canvas }), keyboardModule(), collectorModule(), browserModule()]);
engine.start();
// 游戏结束或页面卸载时：engine.dispose();
```

`canvas` 是应用持有的 HTMLCanvasElement；`collectorModule` 是你的游戏模块。这里没有网络客户端或游戏服务器。可运行 TS 项目见仓库 `templates/browser`，分发归档对应 `starters/browser`；历史完整游戏保存在仓库 `archive/legacy-demos`。

## 增加网络

```ts
import { networkModule } from '@xiaobaibaifqy/jingchuanchu-net/module';

const networking = networkModule<ClientMessage, ServerMessage>({
  url: 'wss://your-game.example/ws',
  decoder: yourServerMessageSchema,
  onMessage: handleGameMessage,
  onStatus: handleConnectionStatus,
});
engine.install([networking]); // 配置阶段，启动前或暂停时
const connection = engine.world.getResource(networking.connection);
engine.start();
// 收到 open 状态后，再调用 connection.send(yourGameCommand)。
```

消息类型、校验 schema、同步内容和规则由游戏定义，引擎不认识答案、回合或玩家分数。网络模块在开始时连接，暂停不会断开；停止或销毁时关闭。暂停期间新安装的网络模块在恢复时首次连接。断线重连策略仍由游戏选择，不默认自动恢复身份。

## 生命周期契约

- `setup(engine, scope)` 是同步配置过程；登记系统、资源和监听器，不应启动自己的独立主循环。
- `engine.install()` 可以分批调用，在停止或暂停状态下安装。依赖可位于同批，也可已安装；重复 ID、缺失依赖和循环在 setup 前拒绝。
- `engine.provide(token, value, scope)` 注册唯一服务，通过 `engine.world.getResource(token)` 获取。失败回滚自动删除本批服务和系统，已有模块保留。
- 自定义模块创建的实体、订阅和资源必须登记到 scope。直接修改既有世界数据不能由安装器自动撤销。
- 生命周期事件为 `started`、`paused`、`resumed`、`stopped`、`disposed`，模块可以通过 `engine.events.on(name, handler, scope)` 订阅。
- 事件监听器异常会聚合报告，其他监听器仍会收到事件；开始或恢复失败时引擎回到停止状态，通知已激活的模块清理。
- 重复调用 `start()` 不重复启动主循环；暂停使用 `resume()` 恢复，停止后使用 `start()` 重启。
- 浏览器切后台只自动恢复由页面可见性造成的暂停，手动暂停不会因为重新切回页面而被取消。
- `engine.dispose()` 按安装顺序反向清理，再销毁 World。持有 Engine 时只调用 Engine.dispose，不单独销毁它的 World。
- 当前没有动态卸载单个模块或异步 setup；需要更换整套功能组合时创建新的 Engine。

资源加载通过 `assetModule({ load, release })` 注入。资源类型及加载方式由调用方提供；引擎不会假定所有资源都是图片。

## 开发与独立使用

工作区通过 npm workspaces 链接包，所有跨包引用使用 `@xiaobaibaifqy/jingchuanchu-*`，不跨目录导入内部源码。开发使用 `source` 条件加载 TS；生产默认入口加载编译后的 JS，TS 消费者获得对应声明。

```bash
npm run build:packages
npm run pack:packages
```

包输出在各包 `dist/`，安装包输出在根目录 `dist/packages/`。可通过公共 npm 包名或本地 tgz 使用。外部项目可以选择本地 tgz，并同时提供所选包的内部依赖，例如只使用内核：

```bash
npm install /path/to/xiaobaibaifqy-jingchuanchu-ecs-0.3.0.tgz /path/to/xiaobaibaifqy-jingchuanchu-core-0.3.0.tgz
```

`npm run test:packages` 会创建临时外部项目，用本地包离线安装，编译并执行 TS 消费代码，检查未选择的网络依赖没有进入安装结果。

依据：[npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/)、[Node package exports](https://nodejs.org/download/release/latest-jod/docs/api/packages.html)。
