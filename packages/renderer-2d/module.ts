import type { EngineModule } from '@xiaobai/core';
import { resource } from '@xiaobai/ecs';
import { Canvas2D } from './index.js';

export const Renderer2D = resource<Canvas2D>('Renderer2D');
export function canvas2DModule(options: {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  renderWorld?: boolean;
  background?: string;
}): EngineModule {
  return {
    id: 'renderer-2d',
    setup(engine, scope) {
      const renderer = new Canvas2D(options.canvas, options.width, options.height);
      engine.provide(Renderer2D, renderer, scope);
      if (options.renderWorld !== false)
        engine.addSystem(
          {
            id: 'renderer-2d:world',
            phase: 'render',
            order: 100,
            update({ world }) {
              renderer.clear(options.background);
              renderer.drawWorld(world);
            },
          },
          scope,
        );
    },
  };
}
