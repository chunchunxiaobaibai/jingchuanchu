# @xiaobai/net-server

Node WebSocket 服务适配，依赖 @xiaobai/net 和外部 ws。HTTP listen 与异步退出由应用管理。

## 安装

当前通过引擎分发套件的 install.mjs 安装，可选择本包并自动补齐内部依赖，尚未上传公共 npm。也可以同时将本包与所需内部包的 tgz 传给 npm install。

## 使用

```ts
import { createServer } from 'node:http';
import { WebSocketHost } from '@xiaobai/net-server';
const http = createServer();
const host = new WebSocketHost(
  http,
  { parse: (value: unknown) => value },
  {
    open() {},
    message() {},
    close() {},
    error() {},
  },
);
await host.close();
// 实际游戏需要自己的 decoder 和规则，示例只展示构造/释放。
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 授权

MIT，见 [LICENSE](LICENSE)。
