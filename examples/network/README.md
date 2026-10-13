# 最小联网接入

分发包内本目录已配置本地引擎依赖：

```bash
npm install
npm run check
npm start
```

服务监听 `ws://127.0.0.1:3002/ws`。`protocol.ts` 提供不依赖 Zod 的运行时校验，`server.ts` 回复 pong，`client.ts` 提供浏览器接入函数。

把 `client.ts` 与 `protocol.ts` 复制到你的浏览器项目，再安装 `@xiaobaibaifqy/jingchuanchu-core`、`@xiaobaibaifqy/jingchuanchu-ecs`、`@xiaobaibaifqy/jingchuanchu-net`。使用 `createPingClient`，等 `connection.status === 'open'` 后调用 `ping()`，结束时 `engine.dispose()`。

示例仅说明传输与协议边界，不实现房间、身份或状态同步。具体联网游戏请继续阅读 `docs/development/networking.md`。
