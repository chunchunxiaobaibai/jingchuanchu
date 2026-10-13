# ECS 与游戏循环

## 实体是引用，组件是数据

```ts
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';

const Position = component<{ x: number; y: number }>('Position');
const Velocity = component<{ x: number; y: number }>('Velocity');
const world = new World();
const player = world.create();
world.set(player, Position, { x: 0, y: 0 });
world.set(player, Velocity, { x: 120, y: 0 });
```

Entity 含 worldId、index、generation。删除后复用 index 会改变 generation；旧引用或其他 World 的引用不能访问新实体。
Entity 不适合 JSON 序列化或作为网络 ID。联网时另建字符串 ID 到 Entity 的映射。

Component token 按 Symbol 身份区分，同名 token 也不同。每种组件只定义一次并导出；系统与生成器共同导入它。
`set` 添加或替换数据，`require` 返回存储中的引用，可以直接修改数值；缺少组件时抛错。`get` 缺少时返回 undefined。

## 查询与结构变更

```ts
for (const entity of world.query(Position, Velocity)) {
  const position = world.require(entity, Position);
  const velocity = world.require(entity, Velocity);
  position.x += velocity.x / 30;
}
```

查询取组件交集。`query()` 不给 token 时遍历所有存活实体；迭代开始时捕获候选实体引用。
组件使用稀疏集，移除采用末尾交换，结果顺序不是创建顺序或稳定排名。需要排序时由游戏明确排序。

建议把创建、删除及组件组合变更排到逻辑步末尾：

```ts
world.defer((current) => current.destroy(player));
```

Engine 每个固定逻辑步后调用 `flush()`；单独使用 World 时由调用者调用。flush 中再次 defer 的命令留到下一次 flush，不无限递归执行。

## 世界资源

```ts
import { resource } from '@xiaobaibaifqy/jingchuanchu-ecs';

const Match = resource<{ elapsed: number }>('Match');
world.setResource(Match, { elapsed: 0 });
world.getResource(Match).elapsed += 1;
```

资源适合配置、当前关卡、共享服务和房间阶段，不为每位玩家各复制一份。缺少资源时 getResource 抛错。
普通游戏状态可直接 setResource；模块提供的服务使用 `engine.provide(token, service, scope)`，以获得重复注册检查和回滚清理。

## 系统与时间

```ts
engine.addSystem({
  id: 'movement',
  phase: 'fixed',
  order: 10,
  update({ world, delta }) {
    for (const entity of world.query(Position, Velocity)) {
      const position = world.require(entity, Position);
      position.x += world.require(entity, Velocity).x * delta;
    }
  },
});
```

`delta` 单位为秒。默认 tickRate=30、maxSteps=5；order 小的先执行，同 order 按注册顺序；系统 ID 在同一个引擎中必须唯一。

一次 advance 的顺序：

```text
累加秒数（限制本次补算量）
  → fixed 系统 → World.flush → 可能继续下一固定步
  → render 系统（一次）
```

fixed 的 delta 是固定 step；render 的 delta 是本次传入秒数。alpha 是累积剩余时间/step，可供自定义插值，内置 Canvas 绘制不自动插值。
大间隔只补算有限步数，超额时间丢弃；房间截止时间等应按权威时钟计算，而不是依赖客户端补帧数量。
timings 是最近一次 advance 中各系统执行记录，单位毫秒；多个固定步会留下多个同 ID 记录。

## 驱动循环

浏览器安装 browserModule 后显式 start。无界面环境手动推进：

```ts
engine.start();
engine.advance(engine.step);
engine.advance(engine.step);
engine.dispose();
```

完整无界面例子见分发 `examples/headless.ts`，它不导入渲染、输入或网络。
不要同时使用 browserModule 和自己的定时器推进同一引擎，否则会重复更新。
stop 不清空世界、分数、系统或 tick，只停止运行并清空时间累积；重开一局的状态重置由游戏实现。

系统 update 抛错会停止引擎并抛出包含 cause 的错误。手动调用 advance 时，调用方还应处理延迟命令中的异常；浏览器驱动会捕获推进异常、停止并通知 onError。
