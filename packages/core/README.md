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

## 授权

MIT，见 [LICENSE](LICENSE)。
