# 镜川初 · Jingchuanchu Engine

面向网页 2D 游戏的 TypeScript ECS 引擎。引擎与具体玩法解耦，按需组合单机、渲染、输入、资源及联机功能。引擎与游戏都使用 TypeScript。

当前公共 npm 版本为 **0.3.0**，采用 [MIT](LICENSE) 授权。8 个包均提供 ESM、类型声明和源码；除服务端使用 `ws` 外，没有第三方运行依赖。

## 安装与开发游戏

仅使用内核，ECS 会自动补齐：

```bash
npm install @xiaobaibaifqy/jingchuanchu-core
```

网页单机组合：

```bash
npm install @xiaobaibaifqy/jingchuanchu-core @xiaobaibaifqy/jingchuanchu-browser @xiaobaibaifqy/jingchuanchu-renderer-2d @xiaobaibaifqy/jingchuanchu-input
```

按需加入 `@xiaobaibaifqy/jingchuanchu-assets`、`@xiaobaibaifqy/jingchuanchu-net` 或 `@xiaobaibaifqy/jingchuanchu-net-server`。安装单机组合不会引入服务端 `ws`。

从 [开发手册](docs/development/README.md) 开始，或复制 `templates/browser` 制作第一个游戏。浏览器需要 ES2022、Canvas 2D 和 Pointer Events；TS 消费项目需要 TypeScript >=5.4。引擎不提供 CommonJS 构建。

## 模块

| 包名后缀    | 职责                                         |
| ----------- | -------------------------------------------- |
| ecs         | 实体、代际 ID、组件查询、资源与延迟命令      |
| core        | 固定步长、系统、模块依赖、事件与资源清理     |
| browser     | 浏览器主循环、页面可见性与暂停恢复           |
| renderer-2d | Canvas 2D、坐标转换、基础图形与笔画          |
| input       | 键盘、指针输入与捕获清理                     |
| assets      | 共享加载缓存、失败重试与资源释放             |
| net         | 浏览器连接、消息解码、房间目录与限流         |
| net-server  | Node WebSocket、心跳、消息大小与发送积压保护 |

完整包名为 `@xiaobaibaifqy/jingchuanchu-<后缀>`。各包的普通入口可直接使用，模块入口负责注册服务、系统和清理；详见 [模块指南](docs/modules.md)。

## 维护仓库

需要 Node.js >=22.12、npm 和 tar。从仓库根目录运行：

```bash
npm ci
npm run build
npm test
npm run test:packages
npm run format:check
```

`build` 只执行严格类型检查和引擎包构建。根目录没有游戏启动入口；历史完整游戏见 [归档说明](archive/README.md)。

```text
packages/       8 个引擎源码包及其 npm 元数据
scripts/        构建、打包和独立消费验证
tests/         引擎回归测试（不含具体游戏规则）
docs/           开发手册、架构与维护说明
distribution/   分发套件的说明模板
templates/      可运行 TS 浏览器 starter
examples/       内核、资源、自定义模块及网络接入示例
archive/        历史游戏、任务记录和本地产物
```

`tests/` 与最小示例保留用于维护和验证发行版。`node_modules/`、`dist/` 和 `archive/artifacts/` 是本地文件，不提交 GitHub。`archive/legacy-demos` 的历史源码可随仓库保存，但不参与主仓库构建或 npm 打包。

## 打包与分发

```bash
npm run pack:packages
npm run dist:release
```

安装包输出到 `dist/packages/`；完整交付套件输出到 `dist/releases/jingchuanchu-engine-0.3.0.tar.gz`，包含 8 个 tgz、校验清单、按需安装器、开发手册与可运行 starter。

完整外部消费验证：

```bash
npx playwright install chromium
npm run test:distribution
```

Linux 需要 Chromium 运行库。此验证会解压归档，在独立项目检查类型、包边界、模板浏览器操作和真实网络通信。

- [npm 发布手册](docs/maintainers/npm-publishing.md)：版本维护、WSL 登录、按依赖顺序发布与远端核对。
- [GitHub 上传说明](docs/maintainers/github.md)：源码范围、仓库关联和首推。
- [架构说明](docs/architecture.md)、[验证记录](docs/validation.md)、[更新记录](CHANGELOG.md)。
- [引擎优化讨论方案](docs/optimization-plan.md)：稳定性、性能和 2D 能力的分阶段建议，尚未实现。

根包为 `private`，分发对象是 `packages/` 内的 8 个包。0.3.0 已发布且不可覆盖；本次仓库归档不自动产生新版本或重新上传 npm。
