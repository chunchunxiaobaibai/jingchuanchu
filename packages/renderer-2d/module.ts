import type { EngineModule, UpdateContext } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Canvas2D } from './index.js';
import type { Camera2D } from './features.js';

export const Renderer2D = resource<Canvas2D>('Renderer2D');
export function canvas2DModule(options: {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  renderWorld?: boolean;
  background?: string;
  camera?: Camera2D;
  shouldRender?: (context: UpdateContext) => boolean;
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
            update(context) {
              if (options.shouldRender && !options.shouldRender(context)) return;
              const { world } = context;
              renderer.clear(options.background);
              renderer.drawWorld(world, options.camera);
            },
          },
          scope,
        );
    },
  };
}
