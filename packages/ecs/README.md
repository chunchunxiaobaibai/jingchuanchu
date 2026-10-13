# @xiaobai/ecs

实体、组件、查询与世界资源。没有外部运行依赖。

## 安装

当前通过引擎分发套件的 install.mjs 安装，可选择本包并自动补齐内部依赖，尚未上传公共 npm。也可以同时将本包与所需内部包的 tgz 传给 npm install。

## 使用

```ts
import { World, component } from '@xiaobai/ecs';
const Position = component<{ x: number }>('Position');
const world = new World();
const entity = world.create();
world.set(entity, Position, { x: 1 });
world.require(entity, Position).x += 1;
world.dispose();
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 授权

MIT，见 [LICENSE](LICENSE)。
