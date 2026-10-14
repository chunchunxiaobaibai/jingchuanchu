# @xiaobaibaifqy/jingchuanchu-ecs

实体、组件、查询与世界资源。没有外部运行依赖。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-ecs
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';
const Position = component<{ x: number }>('Position');
const world = new World();
const entity = world.create();
world.set(entity, Position, { x: 1 });
world.require(entity, Position).x += 1;
world.dispose();
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

查询在每个实体生命周期内复用冻结 handle，仍保留 World 归属与 generation 检查。查询快照不会访问遍历期间回收复用后的新实体，嵌套查询互不覆盖。原有方法名与参数保持。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

## 授权

MIT，见 [LICENSE](LICENSE)。
