# 联网接入

网络是可选功能，单机不导入它。net 不内置具体游戏的消息类型、身份、房间规则或 ECS 同步协议。

## 先定义协议

`Decoder<T>` 只有 `parse(value: unknown): T`，失败时抛错。你可以使用手写校验、Zod 或其他工具；引擎不要求 Zod。
TS 类型不能校验远端 JSON。接收后验证类型、范围和权限，再进入游戏逻辑。

`examples/network/protocol.ts` 定义 ping、pong 和 error，并用运行时校验器限制所消费字段。客户端与服务端共享协议文件，不共享浏览器 DOM 或连接对象。

## 客户端

```ts
const network = networkModule<ClientMessage, ServerMessage>({
  url: () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
  decoder: serverDecoder,
  onMessage: handleServerMessage,
  onStatus: handleStatus,
});
engine.install([network]);
const connection = engine.world.getResource(network.connection);
engine.start();
```

开始后是异步连接。收到 open 或检查 status 为 open 后再 send，send 返回 false 时没有发送；引擎不自动缓存或重试命令。
暂缓游戏逻辑的 pause 不会关闭连接；stop/dispose 会关闭。新模块在暂停期间安装，恢复时首次连接。
没有自动重连或身份恢复；重新 connect 会替换旧 socket，如何恢复房间与进度由游戏制定。

## 服务端

WebSocketHost 依附调用方创建的 Node HTTP Server，提供 `/ws`。HTTP Server 的 listen、静态文件和退出生命周期由应用负责。

```ts
const host = new WebSocketHost(
  http,
  clientDecoder,
  {
    open(peer) {},
    message(peer, message) {
      handleGameCommand(peer.id, message);
    },
    close(peer) {
      removePlayer(peer.id);
    },
    error(peer, message) {
      peer.send({ type: 'error', message });
    },
  },
  allowedOrigins,
);
```

你的 ServerMessage decoder 需要接受服务端会发送的 error。Peer.id 是连接 ID，重连会变化，不是账号 ID。
peer.send 发送 JSON，不能发送 Entity handle、Symbol、循环对象或未定义的协议字段。
应用退出时先 `await host.close()`，再关闭 HTTP；不要把 Promise 清理直接交给同步 Scope。

当前传输限制：消息最多 32 KiB，不支持二进制消息，不启用压缩；总连接上限 1000；单连接每秒窗口最多 100 条消息，超额关闭；服务端发送积压超过 1 MiB 时关闭慢客户端。
每 30 秒检查 pong，未回应下一次检查时终止连接。客户端发送积压超过 256 KiB 时 send 返回 false。

允许同 host 的浏览器 Origin 和显式白名单；没有 Origin 的客户端也可以连接。Origin 检查不是玩家身份认证，身份验证、角色权限和操作频率细分应由游戏处理。

## 房间与状态

RoomDirectory 是成员目录与容量控制，不自动生成房间、销毁游戏 World 或广播。
调用方维护 roomId → 游戏实例、连接 ID → 玩家实体的映射。leave 返回房间是否空，空房间需要主动 dispose/remove。

建议服务器保存权威规则，客户端发送意图：

```text
客户端输入 → 校验后的指令 → 服务端游戏系统 → 公开状态/事件 → 客户端显示
```

为同步消息提供序号和游戏回合/逻辑步编号；新加入发送快照，后续发送增量；断线后重新确认权威状态。
不要直接把整个 World JSON 化，也不要把秘密题目等仅部分玩家可见的数据发给所有客户端。
连续动作游戏需要的预测/插值/校正，以及确定性锁步/回滚，目前都由游戏另行实现。

完整 ping 示例在分发 `examples/network`；复杂的房间与你画我猜规则可参考引擎仓库的 `apps/server/service.ts` 和 `games/draw-guess`，它们不属于分发的引擎依赖。
