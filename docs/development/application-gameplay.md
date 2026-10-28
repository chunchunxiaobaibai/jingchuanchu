# 页面内 2D 场景、动作与计时

本教程演示如何给 application 页面接入一个独立场景。完整的加载、收集、结算和保存闭环仍以默认参考游戏为例；这里新增 arena 页用于说明接线，不替换现有 play 页。组件和路由基础见 [组件教程](application-components.md)。

## 生成页面和场景

```bash
npm run generate -- page arena --route /arena
npm run generate -- scene arena --page arena
```

页面生成会注册路由。场景生成只得到 arena-scene.ts，必须由页面显式使用。下面是新文件的完整示例，CSS 项目可直接替换；Less 项目把样式写入同名 .less。

```ts title="src/pages/arena/arena-scene.ts"
import { defineActions, defineGameScene } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';

export const ArenaActions = defineActions({
  horizontal: {
    kind: 'axis',
    negative: ['ArrowLeft', 'KeyA'],
    positive: ['ArrowRight', 'KeyD'],
    preventDefault: true,
  },
  vertical: {
    kind: 'axis',
    negative: ['ArrowUp', 'KeyW'],
    positive: ['ArrowDown', 'KeyS'],
    preventDefault: true,
  },
  pulse: { kind: 'button', keys: ['Space'], preventDefault: true },
});

export const ArenaScene = defineGameScene({
  id: 'arena/movement',
  actions: ArenaActions,
  setup(context) {
    const player = context.create();
    context.world.set(player, Position2D, { x: 80, y: 270 });
    context.world.set(player, Shape2D, {
      kind: 'circle',
      width: 32,
      height: 32,
      color: '#70d4b0',
      layer: 1,
    });
    let moving = true;
    context.clock.after(10, () => {
      moving = false;
    });
    context.addSystem({
      id: 'movement',
      update({ delta }) {
        const position = context.world.require(player, Position2D);
        const { horizontal: x, vertical: y } = context.actions.axes;
        const length = Math.hypot(x, y);
        if (moving && length) {
          position.x = Math.max(16, Math.min(944, position.x + (x / length) * 220 * delta));
          position.y = Math.max(16, Math.min(524, position.y + (y / length) * 220 * delta));
        }
        if (context.actions.buttons.pulse.pressed) {
          context.clock.tween({
            from: 48,
            to: 32,
            duration: 0.2,
            easing: 'ease-out',
            onUpdate(size) {
              const shape = context.world.require(player, Shape2D);
              shape.width = size;
              shape.height = size;
            },
          });
        }
      },
    });
  },
});
```

context.create/addSystem 创建的实体和系统归场景 Scope，退出自动释放。业务组件定义用 ECS component，数据更新使用 context.world；位置/形状足以由 GameCanvas 的内置 Canvas 绘制显示。scene.setup/onPause/onResume 同步；需要异步准备时使用 prepare(signal, props)，结果从 context.prepared 读取。场景切换失败会保留旧场景，因此不要在 prepare/setup 中提前覆盖共享的“当前关卡/得分”；参考游戏在第一次已提交的固定更新中开始业务会话。

## 页面拥有 GameCanvas

```ts title="src/pages/arena/arena-page.ts"
import {
  definePage,
  effect,
  GameCanvas,
  RouteLink,
  signal,
  type GameCanvasHandle,
  type GameCanvasOptions,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ArenaScene } from './arena-scene.js';

const options: GameCanvasOptions = {
  width: 960,
  height: 540,
  background: '#172031',
  maxPixelRatio: 2,
};
export const ArenaPage = definePage({
  selector: 'game-arena-page',
  components: [GameCanvas, RouteLink],
  setup(context) {
    let handle: GameCanvasHandle | undefined;
    const ready = signal(false),
      notice = signal('正在准备场景…');
    const mountCanvas = signal(false);
    effect(() => {
      if (
        !mountCanvas() &&
        !context.router.pending() &&
        context.router.current()?.fullPath === context.route()?.fullPath
      )
        mountCanvas.set(true);
    }, context.scope);
    return {
      getScene: () => ArenaScene,
      options,
      ready,
      notice,
      mountCanvas,
      onReady(value: GameCanvasHandle) {
        handle = value;
        ready.set(true);
        notice.set('点击画布，用方向键/WASD 移动，空格触发脉冲；10 秒后停止移动。');
      },
      onError() {
        notice.set('场景运行失败，请返回首页后重新进入。');
      },
      pause() {
        handle?.pause();
      },
      resume() {
        handle?.resume();
      },
      async restart() {
        if (!handle) return;
        try {
          await handle.restart();
          if (!context.signal.aborted) notice.set('场景已重开。');
        } catch {
          if (!context.signal.aborted) notice.set('重开失败。');
        }
      },
    };
  },
});
```

```html title="src/pages/arena/arena-page.html"
<main>
  <h1>场景接入示例</h1>
  <p role="status">{{ notice }}</p>
  <div class="board">
    <template when="mountCanvas"
      ><game-canvas
        :scene="getScene()"
        :options="options"
        @ready="onReady($event)"
        @error="onError()"
      ></game-canvas
    ></template>
  </div>
  <button type="button" :disabled="!ready" @click="pause()">暂停</button>
  <button type="button" :disabled="!ready" @click="resume()">继续</button>
  <button type="button" :disabled="!ready" @click="restart()">重开</button>
  <route-link :to="{name:'home'}"><template slot="default">返回首页</template></route-link>
</main>
```

```css title="src/pages/arena/arena-page.css"
main {
  padding: 1rem;
}
.board {
  width: 100%;
  max-width: 60rem;
  aspect-ratio: 16 / 9;
}
game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

手工访问 #/arena。父容器必须有实际尺寸，game-canvas 必须有 display:block。逻辑分辨率固定 960×540，CSS 可以缩放；适配采用居中 contain，DPR 默认上限 2，可设置更低上限。不要另行调用 Canvas2D.resize 或为同一个 Canvas 再创建 createViewport/createActions。

scene/options 是显式引用输入，保留函数和驱动身份；普通 props 是数据快照。通过 getScene() 传定义，避免把含函数的定义放入 signal/computed。options 在一次挂载中固定，setup 中保留同一个对象；尺寸适配改 CSS，需要更换创建参数时重新挂载 GameCanvas。

示例中的 mountCanvas 条件等路由提交后才创建驱动。需要先加载图片时，再同时等待资源就绪；默认 play-page 已示范加载中离页取消、失败重试及晚到结果抑制。

## 传入关卡参数与控制句柄

有参数的场景在 prepare 的 props 参数上标注业务类型，或显式声明 GameSceneDefinition 的泛型。页面用 :props="sceneProps" 传普通数据，scene.setup 通过 context.props 读取。props 不能放 Store 实例、图像、函数或 Entity 的活动引用。

GameCanvas ready 输出 GameCanvasHandle，初次准备及后续成功切换/重开都会输出；error 输出 CanvasHostError，statusChanged 输出状态字符串。handle.status 是只读 signal，可在 effect 中读取，不需要轮询。

| 操作                                                    | 语义                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| handle.pause()/resume()                                 | 手动暂停/继续；页面停用或隐藏仍可能保持暂停                 |
| await handle.restart()                                  | 为当前已提交定义和 props 创建新场景，旧作用域清理；失败拒绝 |
| await handle.switchTo(scene, props)                     | 保留定义与 props 的类型关联，成功后切换                     |
| handle.forScene(scene).setVirtual(action,value,source?) | 仅给当前已提交的该定义发送虚拟动作                          |

组件异构 :scene/:props 不能跨两个字段静态关联类型；需要严格配对时使用 handle.switchTo。当前 defineApplication.inputs 也按数据处理，根组件中暴露 getScene/options 即可，不要通过根 inputs 传带函数定义。

## 动作、指针与虚拟按钮

defineActions 定义 axis 的 negative/positive KeyboardEvent.code，以及 button 的 keys/primary pointer。每个固定步采样一次；axes 为数值，buttons 为 down/pressed/released。快速点按边沿只消费一次；输入失焦、隐藏、暂停和取消时清空，不合成玩法释放指令。指针坐标从 context.actions.pointer.point 读取逻辑 x/y/inside；先判断 inside，再处理留边区域。

键盘仅接收宿主内非交互焦点，先点击画布聚焦。表单、按钮、链接、输入法组合及快捷键保留各自默认行为。方向按钮的虚拟输入应在 pointerdown 设置值，pointerup/pointercancel/lostpointercapture 都归零；拖动时用 pointer capture 防止松开事件丢失。axis 用 number、button 用 boolean；给不同按钮传不同 source，避免松开一方清掉另一方的持有。

参考实现见默认模板 play-page.ts 的 press/release 和 play-scene.ts 的动作声明；不需要额外创建浏览器循环。手动接底层驱动时才使用 createViewport/createActions，其 read 也由现有固定步调用。

## 时钟、缓动、暂停与离页

scene.context.clock 已在固定步推进，不要再调用 advance 或创建 setInterval。after/every 使用正有限秒数，回调同步；返回句柄有只读 status 与 cancel。周期任务每步最多触发一次，多余次数跳过并保留相位。tween 支持数值或同键数值对象，easing 为 linear/ease-in/ease-out/ease-in-out；第一次更新在后续固定步，完成时精确到达 to。更新回调中取消或退出会抑制完成回调。

暂停冻结场景系统、计时和缓动；HUD 属于页面组件，继续响应。页面离开会销毁所属 GameCanvas，释放驱动、输入、场景实体/系统与场景资源。暂停不销毁，重开不应累积旧实体或监听。隐藏/恢复不能覆盖用户的手动暂停，帧失败也不应靠恢复可见性偷偷重启。

需要自己的独立时钟时可 createGameClock({scope,source})，但必须由业务已有循环 advance(delta)，它自己不会启动循环。资源加载、图像和声音的使用方式见 [资源与应用服务](application-services.md)。基础精灵/动画、碰撞与变换见 [0.4.0 扩展](extensions-0.4.md)，完整参考玩法见模板 pages/play。

此教程说明 API 使用，不代表浏览器手感、触控、后台恢复或性能已验收；这些仍按 [人工验收清单](../../tasks/acceptance.md) 记录。
