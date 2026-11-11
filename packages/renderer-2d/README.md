# @xiaobaibaifqy/jingchuanchu-renderer-2d

Jingchuanchu (镜川初) TypeScript engine renderer-2d module。版本 0.6.0，MIT 授权。

开发指南、参数及使用约束统一在配套套件的 docs/index.html；API 见 docs/api/renderer-2d.html。源码仓库内打开 ../../docs/index.html。

包提供编译后的 ESM 和 TypeScript 声明。请使用同一版本套件的配套依赖；浏览器项目只安装所需模块，tooling 作为开发依赖。

0.5.0 新增 `TransformFrameCache`：帧级缓存已计算的 Transform 矩阵，渲染与碰撞检测可共享同一缓存实例避免重复计算。`detectCollisions(world, cache?)` 接受可选缓存参数；无参数调用保持原行为。

## WebGL 2

在页面的 `GameCanvas` 选项中传入渲染器工厂。场景沿用 `Sprite2D`、`Shape2D` 和 `Transform2D`。

```ts
import type { GameCanvasOptions } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createWebGL2Renderer } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/webgl2';

export const canvasOptions: GameCanvasOptions = {
  width: 960,
  height: 600,
  background: '#182031',
  createRenderer: createWebGL2Renderer,
};
```

支持静态 `HTMLImageElement` 或 `ImageBitmap` 精灵、图集帧和实色矩形与圆形。圆形沿用 `Shape2D` 的圆心坐标和直径 `width`。形状颜色使用 `#RRGGBB` 或 `#RRGGBBAA`，背景使用不透明的 `#RRGGBB`。需要自由路径或动态 Canvas/视频纹理的场景可使用默认 Canvas 2D。遇到 WebGL 2 创建失败时，用新 Canvas 重新挂载并省略 `createRenderer` 即可选择默认后端。

独立使用工厂时，在结束绘制后调用 `dispose()`。挂到 `GameCanvas` 时由宿主负责清理。`drawCalls` 和 `textureUploadMs` 分别记录最近一次 `drawWorld()` 的批次数和新纹理准备与提交的 CPU 耗时。
