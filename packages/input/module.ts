import type { EngineModule } from '@xiaobai/core';
import { resource } from '@xiaobai/ecs';
import { KeyboardInput, bindPointer, type PointerHandlers } from './index.js';

export const Keyboard = resource<KeyboardInput>('KeyboardInput');
export function keyboardModule(
  options: { target?: EventTarget; preventDefault?: readonly string[] } = {},
): EngineModule {
  return {
    id: 'keyboard-input',
    setup(engine, scope) {
      const input = new KeyboardInput(options.target ?? window, options.preventDefault ?? []);
      engine.provide(Keyboard, input, scope);
      scope.own(() => input.dispose());
      engine.events.on('paused', () => input.clear(), scope);
      engine.events.on('stopped', () => input.clear(), scope);
    },
  };
}
export function pointerModule(options: {
  id?: string;
  canvas: HTMLCanvasElement;
  handlers: PointerHandlers;
}): EngineModule {
  return {
    id: options.id ?? 'pointer-input',
    setup(_, scope) {
      bindPointer(options.canvas, options.handlers, scope);
    },
  };
}
