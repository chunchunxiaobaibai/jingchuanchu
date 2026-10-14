# @xiaobaibaifqy/jingchuanchu-core

固定步长、系统、模块依赖、作用域与类型化事件。依赖 @xiaobaibaifqy/jingchuanchu-ecs。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-core
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
const engine = new Engine({ tickRate: 30 });
engine.addSystem({
  id: 'game:tick',
  update({ delta }) {
    console.log(delta);
  },
});
engine.start();
engine.advance(engine.step);
engine.dispose();
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

新增可选 `diagnostics:false`、系统 `before/after` 约束、`getSystems()`/`getModules()` 和带上下文的 `SystemError`。默认仍采集 timings。`/scenes` 提供 `SceneManager`，支持异步准备、场景切换、暂停与 Scope 清理；不依赖 DOM。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

## 授权

MIT，见 [LICENSE](LICENSE)。
