# @xiaobai/renderer-2d

Canvas 2D 与 Position2D/Shape2D 组件。/module 提供 canvas2DModule 和 Renderer2D 服务 token。

## 安装

当前通过引擎分发套件的 install.mjs 安装，可选择本包并自动补齐内部依赖，尚未上传公共 npm。也可以同时将本包与所需内部包的 tgz 传给 npm install。

## 使用

```ts
import { Canvas2D } from '@xiaobai/renderer-2d';
const canvas = document.querySelector<HTMLCanvasElement>('canvas');
if (!canvas) throw new Error('Create a canvas first');
const renderer = new Canvas2D(canvas);
renderer.clear();
renderer.stroke({ color: '#176b58', width: 5, points: [{ x: 20, y: 20 }] });
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 授权

MIT，见 [LICENSE](LICENSE)。
