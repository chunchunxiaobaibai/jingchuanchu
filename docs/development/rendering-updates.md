# 表单输入与游戏渲染解耦

适用于本地未发布的 0.4.0。引擎不管理应用的整页 DOM；以下接口解决引擎内可确认的重复写入、输入状态和回调异常问题。远端应用仍需把表单状态与 Engine/场景生命周期分开。

## 网络异常传播

JSON/decoder 失败报告 decode，按原协议策略关闭连接。onMessage/onStatus 中的同步异常及其返回 Promise 的拒绝报告 handler，不改成 error/closed 连接状态，也不因业务 UI 异常关闭 socket。

应用的 onError 应按 kind 处理，不能把所有 handler 错误都当成断线。onError 自身失败只记录 lastError，不递归调用错误回调。已有正常重连策略保留；不因 UI 回调失败重新初始化整页。

## 只更新实际变化的 DOM

从 `@xiaobaibaifqy/jingchuanchu-browser/dom` 引用：

```ts
import { setText, createKeyedList } from '@xiaobaibaifqy/jingchuanchu-browser/dom';

setText(timerLabel, `${seconds}s`); // 文本相同就不写 DOM

const playersView = createKeyedList<Player, string>(playersContainer, {
  key: (player) => player.id,
  create: () => document.createElement('li'),
  equal: (a, b) => a.name === b.name && a.score === b.score,
  update: (row, player) => setText(row, `${player.name} · ${player.score}`),
});
playersView.update(players);
```

timerLabel、playersContainer、players 和 Player 由应用提供。列表实例只在容器挂载时创建一次，后续调用 update；以唯一、稳定的 ID 复用行节点，仅有变化的行调用 update。重排移动现有节点，移除已消失的行，不先清空整个列表。

equal 用于不可变快照，需要比较所有影响显示的字段。原地修改对象时不要传 equal；update 内用 setText 等实际值比较避免无效 DOM 写入。setText 用于文本叶节点，不要用它覆盖包含输入框的整块容器。

不要把 Date.now/随机数作为列表或 Canvas 的 key，也不要在每次 input 事件中重新创建 Engine、Renderer 或 SceneManager。销毁只对应实际卸载或游戏退出，场景切换只对应真实场景变化。

## 指针、焦点和输入法

PointerHandlers 新增可选 cancel(event, reason)，reason 为 pointercancel/lostpointercapture/blur/dispose。提供 cancel 后，取消和失去捕获不会再调用正常 up；只处理状态清理，不把取消提交为完成操作。

```ts
pointerModule({
  canvas,
  handlers: {
    down: beginDrag,
    move: moveDrag,
    up: finishDrag,
    cancel: () => {
      dragging = false;
    },
  },
});
```

旧代码未提供 cancel 时，原 pointercancel/失捕仍回退到 up；dispose 不补发旧 up。当前指针状态在回调前清理，捕获在 finally 释放；窗口失焦和 Scope 销毁也清理。

KeyboardInput 忽略输入框/可编辑元素的按键，焦点变化和 blur 清空原游戏键状态；中文输入法 composition 期间以及 isComposing/keyCode=229 的事件不进入游戏按键状态，也不被游戏的 preventDefault 干扰。

## Canvas 初始化与重绘条件

resize 只在配置实际变化时设置变换，只对真正变化的 width/height 写入画布属性。相同尺寸的 resize 不再清空缓冲；同尺寸重复构造 Renderer 也不会重写画布宽高。

原因是 canvas.width 即使赋相同值也会清空缓冲和重置绘图状态：[MDN width](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/width)。真正调整物理尺寸仍会清空，应用需在随后绘制。

默认持续渲染保持不变，避免动画或直接组件修改停止更新。静态场景可选择：

```ts
let drawingDirty = true;
engine.install([
  canvas2DModule({
    canvas,
    shouldRender: () => {
      const render = drawingDirty;
      drawingDirty = false;
      return render;
    },
  }),
]);
```

图形、相机、场景或尺寸变化时设置 drawingDirty=true；纯表单文字或 HUD 变化不设置它。不要对有持续动画的场景使用只更新一次的条件。即使选择按需绘制，浏览器循环和逻辑步仍运行，仅跳过该帧 Canvas 清空/绘制。

键盘依据：[MDN keydown/IME](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)。此轮未启动浏览器，远端页面的最终闪屏情况需要应用实际验证。
