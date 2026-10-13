import './style.css';
import { Engine } from '@xiaobai/core';
import { browserModule } from '@xiaobai/browser';
import { canvas2DModule, Renderer2D } from '@xiaobai/renderer-2d/module';
import { keyboardModule, pointerModule } from '@xiaobai/input/module';
import { gameModule, Game } from './game.js';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const pause = document.querySelector<HTMLButtonElement>('#pause');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !pause || !status) throw new Error('Missing game UI');
const engine = new Engine();
engine.install([
  canvas2DModule({ canvas, background: '#fbfcf8' }),
  keyboardModule({ preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] }),
  gameModule(),
  pointerModule({
    canvas,
    handlers: {
      down(event) {
        if (engine.status === 'running')
          engine.world.getResource(Game).target = engine.world
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
      status.textContent = '运行异常，请查看控制台';
    },
  }),
]);
const update = (): void => {
  pause.textContent = engine.status === 'paused' ? '继续' : '暂停';
  status.textContent = engine.status === 'paused' ? '已暂停' : '运行中';
};
engine.events.on('paused', update, engine.scope);
engine.events.on('resumed', update, engine.scope);
pause.addEventListener('click', () => {
  if (engine.status === 'paused') engine.resume();
  else engine.pause();
});
window.addEventListener('pagehide', () => engine.dispose(), { once: true });
engine.start();
