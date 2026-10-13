# 自定义模块

## 最小契约

```ts
import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource } from '@xiaobaibaifqy/jingchuanchu-ecs';

export const Settings = resource<{ difficulty: number }>('GameSettings');
export function settingsModule(): EngineModule {
  return {
    id: 'game:settings',
    setup(engine, scope) {
      engine.provide(Settings, { difficulty: 1 }, scope);
    },
  };
}
```

setup 是同步配置过程。不用 async setup，不在里面启动新的独立游戏循环。资源可以异步加载，但注册 loader 后让应用 await 加载结果。
ID 是字符串，建议游戏模块用 `game:` 前缀，系统用 `module:action` 前缀。依赖描述模块 ID，不是 npm 包名：

```ts
const movementModule: EngineModule = {
  id: 'game:movement',
  dependencies: ['keyboard-input'],
  setup(engine, scope) {
    engine.addSystem({ id: 'game:movement:tick', update() {} }, scope);
  },
};
```

## 安装事务

install 先检查重复 ID、缺失依赖和循环，然后按依赖顺序 setup。
可以分批安装，依赖可来自上一批。运行中先 pause 或 stop 再安装，之后 resume 或 start。

失败时反向清理本批 scope；通过 provide/addSystem/订阅 scope 登记的服务、系统和监听器会撤销，已提交的旧模块保留。
setup 直接写入旧世界数据、修改外部对象或创建实体，不会自动回滚，必须登记清理：

```ts
const entity = engine.world.create();
scope.own(() => engine.world.destroy(entity));
```

同一实例不能重复安装同 ID，不支持只卸载某一个模块。需要更换整套能力组合时销毁实例再创建新的 Engine。

## 服务、事件和生命周期

通过 provide 注册服务；其他系统用 world.getResource 获取。重复提供同一个 token 会抛错，避免静默覆盖。
assets 和 network 工厂返回的 cache/connection 是 token，而不是缓存/连接实例。

```ts
const assets = assetModule({ load: loadTexture, release: releaseTexture });
engine.install([assets]);
const cache = engine.world.getResource(assets.cache);
```

类型化事件：

```ts
const events = new EventBus<{ damaged: { targetId: string; amount: number } }>();
events.on('damaged', ({ amount }) => console.log(amount), scope);
events.emit('damaged', { targetId: 'player-1', amount: 10 });
```

on 返回取消订阅函数，可重复调用；传 scope 时也在 scope 清理时取消。emit 同步执行事件监听器，不是排队到下一帧。
监听器异常会聚合报告，其他监听器仍执行。事件 payload 是共享引用，不自动复制。

| Engine 事件 | 时机                                   |
| ----------- | -------------------------------------- |
| started     | 停止或暂停状态调用 start，时间累积归零 |
| paused      | 从运行状态暂停                         |
| resumed     | 从暂停状态恢复                         |
| stopped     | 从非停止状态停止                       |
| disposed    | 开始销毁，在 scope 和 World 清理之前   |

使用 `engine.events.on(name, callback, scope)` 登记。开始/恢复阶段异常会通知 stopped，让已激活的模块清理。

## 清理责任

Scope 按登记顺序反向调用清理函数，某一个清理异常不会阻止其他清理，最后聚合抛出。
dispose 可重复调用；关闭后的 scope 再 own 一个函数，会立即执行它。
own 返回原清理函数，不自动把函数包装成幂等释放；通常交给 scope 执行一次即可。

计时器、DOM 监听器、实体和资源应登记；不要保存已销毁 World 的实体继续访问。
Scope 清理是同步的，不等待 Promise。`WebSocketHost.close()` 是异步接口，应由应用入口显式 await，再关闭 HTTP 服务。

完整可运行例子见 `examples/custom-module.ts`。包开发者新增能力时，首先定义 typed token 和 EngineModule 接口，再补实现与消费验证，不把某款游戏的字段写进引擎。
