# @xiaobaibaifqy/jingchuanchu-net

浏览器消息连接、Decoder、房间目录与限流。/module 提供 networkModule，不内置具体游戏协议。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-net
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { RoomDirectory } from '@xiaobaibaifqy/jingchuanchu-net';
const rooms = new RoomDirectory<{ started: boolean }>();
rooms.create('room-1', { started: false });
rooms.join('room-1', 'player-1');
if (rooms.leave('room-1', 'player-1')) rooms.remove('room-1');
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 授权

MIT，见 [LICENSE](LICENSE)。
