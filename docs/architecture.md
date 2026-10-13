# TS 2D 引擎与基础版你画我猜

## 能力与依赖

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| core | 事件、作用域、时间、系统与模块生命周期 | 无 |
| ecs | 代际实体 ID、稀疏集、组件查询、资源、命令队列 | 无 |
| browser | 浏览器主循环、Canvas 2D、指针输入、资源缓存 | core、ecs |
| net | 可校验的消息传输、房间容量与成员管理 | 无 |
| draw-guess | 玩家组件、回合、画布、猜词、计分与协议 | core、ecs、net |
| apps | 浏览器 UI 与 Node WebSocket/HTTP 启动入口 | 上述模块 |

实现顺序：ECS → 调度与生命周期 → 浏览器适配 → 网络 → 游戏规则 → UI 与联网验证。
引擎不得依赖游戏；游戏代码同样使用 TypeScript。组件由 typed token 定义，数据与逻辑分离。示例：`const Score = component<{ value: number }>('Score')`。

## 首版验收

- 旧实体引用不能访问复用后的实体；组件查询与稀疏集移除正确。
- 系统顺序稳定，结构变更可延迟到逻辑步末尾；固定步长更新限制补帧。
- 模块依赖检查、反向释放，事件订阅和资源可清理。
- 2D Canvas 支持坐标转换、笔画、ECS 图形绘制；指针支持触摸与鼠标。
- 网络使用运行时 schema 校验、消息大小限制、心跳、发送积压保护。
- 创建/加入房间，最多 10 人；房主开始，至少 2 人，轮流绘画。
- 服务器保管答案；其他玩家仅收到提示，重复猜中不能重复计分。
- 绘画权限、回合 ID、输入范围和频率由服务端校验。
- 超时/全部猜中后公布答案；房主进入下一回合，一轮每人画一次。
- 退出和断线释放成员；重新加入获取房间与画布快照（不恢复旧身份）。

## 边界与验证

房间仅驻留内存，单服务进程，无账号、持久化、匹配或部署。房主断线转移；绘画者断线结束当前回合。
逻辑、协议及 UI 代码全部为 TS；HTML/CSS 用于页面结构与样式。
构建 `npm run build`，类型检查 `npm run typecheck`，单元/真实 WebSocket 测试 `npm test`，浏览器测试 `npm run test:e2e`。
先验证内核，再验证真实网络和两个浏览器客户端。始终验证外部数据，不提交环境密钥，不编辑第三方源码。

## 官方参考

- [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict)
- [Vite server proxy](https://vite.dev/config/server-options)
- [ws API 与 maxPayload](https://github.com/websockets/ws/blob/master/doc/ws.md)
