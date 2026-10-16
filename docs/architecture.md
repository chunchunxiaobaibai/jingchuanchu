# 引擎架构

镜川初是面向网页 2D 游戏的 TS 引擎，ECS 数据、运行循环和浏览器能力分层。具体玩法、账号、分数、回合及消息协议由游戏提供。

## 包边界

```text
游戏 TypeScript 模块
  → browser / renderer-2d / input / assets / net
  → core
  → ecs

Node 游戏服务 → net-server → net
```

renderer、input、assets、net 同时直接使用 ECS 的公开入口。browser 依赖 core；net-server 的唯一外部运行依赖为 ws。引擎不依赖 archive、游戏规则或 Zod。

- ECS：typed token、World 所属与代际实体 handle、稀疏集、查询快照、资源和延迟命令。
- core：固定逻辑步与独立渲染步、稳定系统顺序、模块依赖验证、安装回滚、生命周期事件及 Scope 清理。
- 浏览器模块：接入 Canvas、键盘、指针、资源加载和 requestAnimationFrame，由应用提供 DOM 对象。
- 网络模块：传输与 decoder 边界；具体身份、房间状态同步及断线恢复由游戏定义。

查询会保存实体 handle 快照，防止遍历期间回收复用的实体进入旧查询。模块失败时反向清理本批登记资源；直接修改既有世界的数据不具备自动事务回滚。

## 维护与交付

`packages/` 是唯一 npm 包源码；跨包只导入公开包名。根 workspace 为构建、测试和打包提供工具，不作为 npm 产品发布。

`tests/` 检查引擎行为和包边界。`examples/` 与 `templates/` 是外部消费契约的可运行参考，参与分发验证。仓库只保留引擎开发与交付所需内容，具体游戏在独立项目中开发。

`pack:packages` 生成每包 tgz，`dist:release` 生成带校验、文档和模板的 tar.gz。只发布已验证的 tgz；历史产物不覆盖现有公开版本。

## 当前限制

本地 0.4.0 提供精灵动画、场景与基础碰撞。没有编辑器、刚体物理、音频、异步 EngineModule.setup 或单模块卸载。网络策略可选启用，未提供通用状态同步或身份恢复协议。性能证据见 [测量报告](performance/README.md)。

## 可选应用与开发工具

app → core/ecs/browser/input，负责类型化命令、展示快照、场景与视图实例；核心包不反向依赖 app。tooling 仅在开发/构建期关联三文件、编译 Less/CSS、生成项目和代码，通过注入组件资源与 app 协作。运行时不依赖 tooling/Vite/Less。共 10 个交付包，原有 8 包及入口保留。具体接口见 [应用套件](development/application-suite.md)。

下一阶段应用模型以 [SPEC](../SPEC.md) 和对应模块规格为准；本文以上内容描述现有 0.4.0 实现，不把新路由/Store/主题列为已实现。
