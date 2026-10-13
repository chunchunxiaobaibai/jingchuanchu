import './style.css';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { browserModule } from '@xiaobaibaifqy/jingchuanchu-browser';
import { canvas2DModule, Renderer2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';
import { keyboardModule, pointerModule } from '@xiaobaibaifqy/jingchuanchu-input/module';
import { Collector, collectorModule, resetCollector } from '../../../games/singleplayer/index.js';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}
const canvas = element<HTMLCanvasElement>('canvas');
const engine = new Engine();
const pause = element<HTMLButtonElement>('pause');
const updateHud = (): void => {
  const state = engine.world.getResource(Collector);
  element('score').textContent = `${state.score} / ${state.total}`;
  element('result').hidden = !state.complete;
  pause.textContent = engine.status === 'paused' ? '继续' : '暂停';
  element('status').textContent =
    engine.status === 'paused'
      ? '游戏已暂停。点击继续，接着收集。'
      : state.complete
        ? '全部收集完成！可以重新开始。'
        : '方向键 / WASD 移动，也可以点击画面前往。';
};
engine.install([
  canvas2DModule({ canvas, background: '#fbfcf8' }),
  keyboardModule({ preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'] }),
  collectorModule(),
  pointerModule({
    canvas,
    handlers: {
      down(event) {
        if (engine.status === 'running')
          engine.world.getResource(Collector).target = engine.world
            .getResource(Renderer2D)
            .toPoint(event.clientX, event.clientY);
      },
      move() {},
      up() {},
    },
  }),
  browserModule({
    onError(error) {
      console.error(error);
      element('status').textContent = '游戏运行异常，请刷新页面。';
    },
  }),
]);
engine.addSystem({ id: 'collector:hud', phase: 'render', order: 200, update: updateHud });
engine.events.on('paused', updateHud, engine.scope);
engine.events.on('resumed', updateHud, engine.scope);
pause.addEventListener('click', () => {
  if (engine.status === 'paused') engine.resume();
  else engine.pause();
  updateHud();
});
element('restart').addEventListener('click', () => {
  resetCollector(engine.world);
  if (engine.status === 'paused') engine.resume();
  updateHud();
});
window.addEventListener('pagehide', () => engine.dispose(), { once: true });
engine.start();
