# 引擎开发手册

本手册以当前源码的网页 2D application 模型为默认开发方式，入口为 `@xiaobaibaifqy/jingchuanchu-app/application`。当前预发布版本为 0.5.0-rc.1；历史同版本附件不自动包含新模型，使用前确认包的构建来源。旧根入口保留，旧项目见 [旧应用套件手册](application-suite.md) 和 [旧目录迁移参考](project-structure.md)。

## 开始制作游戏

1. [快速入门](getting-started.md)：从源码或配套套件创建项目，运行参考游戏并构建网页。
2. [应用开发总览](application-framework.md)：业务目录、配置、CLI、跨页状态及新旧迁移。
3. [组件与页面教程](application-components.md)：完整三文件示例、输入/输出/model、Store 和路由。
4. [2D 场景与游戏能力](application-gameplay.md)：场景系统、GameCanvas、动作、暂停和固定步计时。
5. [资源与应用服务](application-services.md)：资源租约、主题替换、音频、保存、可选认证和权限。
6. [应用 API 索引](application-api.md)：公开函数、关键参数、返回值、默认值和生命周期约束。
7. [常见问题](troubleshooting.md)：安装、编译、输入、Canvas、资源、音频和保存诊断。

## 直接接入底层包

| 主题                     | 文档                                                          |
| ------------------------ | ------------------------------------------------------------- |
| 实体、系统、固定步与循环 | [ECS 与循环](ecs-and-loop.md)                                 |
| EngineModule、服务与清理 | [自定义模块](custom-modules.md)、[模块目录](../modules.md)    |
| Canvas、底层输入与缓存   | [浏览器功能](browser-features.md)                             |
| 客户端、服务端与协议     | [联网接入](networking.md)                                     |
| 原有包方法签名           | [底层 API](api-reference.md)、[0.4.0 扩展](extensions-0.4.md) |
| 旧展示状态更新           | [渲染更新](rendering-updates.md)                              |

使用 GameCanvas 时，由它管理所属 Engine、Canvas、帧和输入；底层接入文档用于直接管理这些能力的项目。不要给同一画布同时安装两套驱动。

## 构建与维护

[源码构建](build-from-source.md) 区分引擎编译、套件归档和游戏网页构建；[分发与安装](distribution.md) 说明 vendor、摘要、选择安装与升级。正式对外交付另见 [GitHub 交付](../maintainers/github-delivery.md)、[npm 发布](../maintainers/npm-publishing.md)。这些是独立操作，本地构建不等于发布。

[SPEC](../../SPEC.md) 是当前实现契约入口；[plan](../../tasks/plan.md) 管执行顺序，[todo](../../tasks/todo.md) 管状态，[验收清单](../../tasks/acceptance.md) 管实际检查与未覆盖项。当前音频/保存/认证接入能力已有源码；真实浏览器、设备和性能仍需单独验收。

## 运行条件与交付内容

构建与服务端使用 Node.js >=22.12.0、npm；生成归档还需 tar。浏览器需要 ES2022、Canvas 2D、Pointer Events 和 requestAnimationFrame；网络使用 WebSocket，浏览器音频驱动使用 Web Audio。包只提供 ESM 与声明。模板使用配套工具版本，普通消费项目不配置 source 条件。

共 10 个包：8 个基础引擎包、app 运行包、tooling 开发包。tooling 仅放 devDependencies，net-server 依赖 ws。引擎不提供 3D、完整刚体、编辑器、账号数据库或自动游戏同步。

```text
jingchuanchu-engine-0.5.0-rc.1/
  README.md / LICENSE / CHANGELOG.md
  manifest.json / SHA256SUMS
  install.mjs
  packages/              10 个 tgz
  docs/                  开发文档与规格
  tasks/                 实施与验收记录
  starters/browser/      当前参考游戏
  examples/              底层、网络及可选账号适配示例
```

源码、文档和示例按 MIT 授权。分发前保留引擎及素材许可证；Node/模拟检查不能代替真实设备游玩或性能测量。
