# 浏览器功能接入

## 绘制

```ts
import { Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { canvas2DModule, Renderer2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';

engine.install([canvas2DModule({ canvas, width: 960, height: 600 })]);
const object = engine.world.create();
engine.world.set(object, Position2D, { x: 200, y: 150 });
engine.world.set(object, Shape2D, {
  kind: 'rect',
  color: '#176b58',
  width: 40,
  height: 24,
  layer: 0,
});
```

内置系统在 render 阶段清空画布，然后按 layer 升序绘制同时拥有 Position2D 和 Shape2D 的实体。圆形的 position 是圆心，width 是直径，height 不参与圆形绘制；矩形 position 是左上角。

Canvas 的逻辑尺寸默认 960×600，物理像素使用构造时 devicePixelRatio，最多 2 倍。CSS 负责页面缩放；逻辑尺寸不会因 CSS 改变。
需要多个画布或自定义绘制，可直接创建 Canvas2D，或禁用自动世界绘制：

```ts
engine.install([canvas2DModule({ canvas, renderWorld: false })]);
const renderer = engine.world.getResource(Renderer2D);
engine.addSystem({
  id: 'game:draw',
  phase: 'render',
  update() {
    renderer.clear('#ffffff');
    renderer.stroke({
      color: '#202c37',
      width: 5,
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    });
  },
});
```

这是与上一个安装示例二选一的配置，不在同一 Engine 重复安装 renderer-2d。当前没有相机、贴图、文字或自动插值系统；可使用 renderer.context 的原生 Canvas API 扩展。

## 键盘

keyboardModule 提供 Keyboard 服务。isDown 使用 `KeyboardEvent.code`，例如 KeyW 或 ArrowUp，不使用本地化字符。
编辑 input、textarea、select 或 contenteditable 时不采集按下操作；失去焦点、暂停和停止时清空状态。
preventDefault 只阻止显式选择的按键默认动作，建议为方向键配置，防止移动时页面滚动。

## 指针

```ts
pointerModule({
  canvas,
  handlers: {
    down(event) {
      const point = engine.world.getResource(Renderer2D).toPoint(event.clientX, event.clientY);
      engine.world.getResource(Game).target = point;
    },
    move() {},
    up() {},
  },
});
```

接受主要指针的左键/触摸操作，一次处理一个指针。移动只在捕获期间转发；pointerup、cancel 或 lost capture 只结束一次。
模块清理时释放捕获并移除监听器。Canvas 应设置 `touch-action: none`，模板已配置。
toPoint 把 CSS 坐标映射到逻辑画布并限制到范围内；更复杂的镜头变换由游戏自行实现。

## 资源

AssetCache 接受自己的 Promise loader。并发读取相同 URL 共享一次加载，失败时删除缓存项，下一次 get 可以重试。
clear 释放所有已登记资源，缓存仍可再次使用；dispose 关闭缓存，此后 get 返回拒绝的 Promise。

```ts
import { assetModule } from '@xiaobaibaifqy/jingchuanchu-assets/module';

const images = assetModule<ImageBitmap>({
  id: 'images',
  async load(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    return createImageBitmap(await response.blob());
  },
  release(image) {
    image.close();
  },
});
engine.install([images]);
const image = await engine.world.getResource(images.cache).get('/assets/player.png');
```

加载器负责协议、状态码和数据校验。release 回调应处理自己的错误；clear/dispose 不等待异步资源释放。
模板不默认安装 assets，因为移动圆形不需要资源加载。资源演示见 `examples/assets.ts`。

## 浏览器循环

browserModule 在 started/resumed 后请求帧，在 pause/stop/dispose 时取消帧；隐藏页面自动暂停，恢复时不补算全部后台时间。
只自动恢复由可见性导致的暂停；原本手动暂停的游戏不会因为切回页面而自动恢复。
需要测试或特殊宿主时传 BrowserDriver；驱动接口只负责请求/取消帧及可见性订阅，不负责游戏规则。
