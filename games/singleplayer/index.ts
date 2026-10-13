import type { EngineModule } from '@xiaobai/core';
import { component, resource, type Entity, type World } from '@xiaobai/ecs';
import { Position2D, Shape2D, type Point } from '@xiaobai/renderer-2d';
import { Keyboard } from '@xiaobai/input/module';

const Star = component<boolean>('Star');
export interface CollectorState {
  player: Entity;
  score: number;
  total: number;
  complete: boolean;
  width: number;
  height: number;
  target: Point | null;
}
export const Collector = resource<CollectorState>('Collector');
export function resetCollector(world: World): void {
  const state = world.getResource(Collector);
  for (const entity of world.query(Star)) world.destroy(entity);
  state.score = 0;
  state.complete = false;
  state.target = null;
  world.set(state.player, Position2D, { x: state.width / 2, y: state.height / 2 });
  for (const [x, y] of [
    [0.2, 0.25],
    [0.42, 0.25],
    [0.75, 0.25],
    [0.75, 0.72],
    [0.25, 0.75],
  ]) {
    const star = world.create();
    world.set(star, Star, true);
    world.set(star, Position2D, { x: x! * state.width, y: y! * state.height });
    world.set(star, Shape2D, { kind: 'rect', color: '#e6a323', width: 18, height: 18, layer: 0 });
  }
}
export function collectorModule(options: { width?: number; height?: number } = {}): EngineModule {
  return {
    id: 'collector-game',
    dependencies: ['keyboard-input'],
    setup(engine, scope) {
      const world = engine.world;
      const player = world.create();
      world.set(player, Shape2D, {
        kind: 'circle',
        color: '#176b58',
        width: 28,
        height: 28,
        layer: 1,
      });
      engine.provide(
        Collector,
        {
          player,
          score: 0,
          total: 5,
          complete: false,
          width: options.width ?? 960,
          height: options.height ?? 600,
          target: null,
        },
        scope,
      );
      resetCollector(world);
      scope.own(() => {
        for (const star of world.query(Star)) world.destroy(star);
        world.destroy(player);
      });
      engine.addSystem(
        {
          id: 'collector:movement',
          update({ world, delta }) {
            const state = world.getResource(Collector);
            if (state.complete) return;
            const input = world.getResource(Keyboard);
            const position = world.require(state.player, Position2D);
            let x =
              Number(input.isDown('ArrowRight') || input.isDown('KeyD')) -
              Number(input.isDown('ArrowLeft') || input.isDown('KeyA'));
            let y =
              Number(input.isDown('ArrowDown') || input.isDown('KeyS')) -
              Number(input.isDown('ArrowUp') || input.isDown('KeyW'));
            let distance = Math.hypot(x, y);
            let travel = 240 * delta;
            if (distance) state.target = null;
            else if (state.target) {
              x = state.target.x - position.x;
              y = state.target.y - position.y;
              distance = Math.hypot(x, y);
              travel = Math.min(travel, distance);
              if (distance < 1) state.target = null;
            }
            if (distance) {
              position.x += (x / distance) * travel;
              position.y += (y / distance) * travel;
            }
            position.x = Math.max(14, Math.min(state.width - 14, position.x));
            position.y = Math.max(14, Math.min(state.height - 14, position.y));
            for (const entity of world.query(Star, Position2D)) {
              const star = world.require(entity, Position2D);
              if (Math.hypot(position.x - star.x - 9, position.y - star.y - 9) <= 24) {
                world.defer((w) => w.destroy(entity));
                state.score++;
              }
            }
            state.complete = state.score === state.total;
          },
        },
        scope,
      );
    },
  };
}
