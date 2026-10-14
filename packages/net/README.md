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

## 0.4.0 扩展

BrowserConnection 与 networkModule 新增可选重连、应用层心跳、错误分类与 stats。send(message) 保留；send(message,{queue:true,key}) 可显式使用有数量/字节上限的队列，key 只用于可丢弃更新合并。重连、心跳和排队默认关闭，close 会取消重试与队列。引擎不自动恢复玩家身份或分数。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

onMessage/onStatus 的同步异常与返回 Promise 的拒绝都会按 handler 报告，不按解析异常关闭连接；onError 自身失败不会递归触发错误通知。

## 授权

MIT，见 [LICENSE](LICENSE)。
