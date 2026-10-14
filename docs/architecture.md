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

`tests/` 检查引擎行为和包边界。`examples/` 与 `templates/` 是外部消费契约的可运行参考，参与分发验证。完整游戏单独保存在 `archive/legacy-demos`，默认使用公共 npm 的 0.3.0，不参与根类型检查、构建或测试。

`pack:packages` 生成每包 tgz，`dist:release` 生成带校验、文档和模板的 tar.gz。只发布已验证的 tgz；历史产物不覆盖现有公开版本。

## 当前限制

没有编辑器、物理、音频、精灵动画、场景管理、异步 setup 或单模块卸载。Canvas 提供基础图形与笔画，网络提供连接与服务端传输基础，未提供通用状态同步协议。优化建议见 [讨论方案](optimization-plan.md)。
