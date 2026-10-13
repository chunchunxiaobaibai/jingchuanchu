import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource, type Entity } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Position2D, Shape2D, type Point } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Keyboard } from '@xiaobaibaifqy/jingchuanchu-input/module';

export const Game = resource<{ player: Entity; target: Point | null }>('MyGame');
export function gameModule(): EngineModule {
  return {
    id: 'my-game',
    dependencies: ['keyboard-input'],
    setup(engine, scope) {
      const player = engine.world.create();
      engine.world.set(player, Position2D, { x: 480, y: 300 });
      engine.world.set(player, Shape2D, {
        kind: 'circle',
        color: '#176b58',
        width: 32,
        height: 32,
        layer: 1,
      });
      engine.provide(Game, { player, target: null }, scope);
      scope.own(() => engine.world.destroy(player));
      engine.addSystem(
        {
          id: 'my-game:move',
          update({ world, delta }) {
            const input = world.getResource(Keyboard);
            const game = world.getResource(Game);
            const position = world.require(game.player, Position2D);
            let x =
              Number(input.isDown('ArrowRight') || input.isDown('KeyD')) -
              Number(input.isDown('ArrowLeft') || input.isDown('KeyA'));
            let y =
              Number(input.isDown('ArrowDown') || input.isDown('KeyS')) -
              Number(input.isDown('ArrowUp') || input.isDown('KeyW'));
            let distance = Math.hypot(x, y);
            let travel = 240 * delta;
            if (distance) game.target = null;
            else if (game.target) {
              x = game.target.x - position.x;
              y = game.target.y - position.y;
              distance = Math.hypot(x, y);
              travel = Math.min(travel, distance);
              if (distance < 1) game.target = null;
            }
            if (distance) {
              position.x += (x / distance) * travel;
              position.y += (y / distance) * travel;
            }
            position.x = Math.max(16, Math.min(944, position.x));
            position.y = Math.max(16, Math.min(584, position.y));
          },
        },
        scope,
      );
    },
  };
}
