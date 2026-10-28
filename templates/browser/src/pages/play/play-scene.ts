import { component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Position2D, Shape2D, type Point } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Collider2D, detectCollisions } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { defineActions, defineGameScene } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore, type RunOutcome } from '../../game/session/game-store.js';
import { findLevel, type LevelId } from '../../game/session/levels.js';

export const playBounds = Object.freeze({ width: 960, height: 540, radius: 16, speed: 220 });
export const Collector = component<{ target: Point | null }>('Collector');
export const Collectible = component<true>('Collectible');
export const playActions = defineActions({
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
  destination: { kind: 'button', pointer: 'primary', preventDefault: true },
});
export interface PlaySceneProps {
  readonly levelId: LevelId;
}
export const PlayScene = defineGameScene({
  id: 'collect-light',
  actions: playActions,
  prepare(_signal, props: Readonly<PlaySceneProps>) {
    if (!findLevel(props.levelId)) throw new Error('Unknown game level');
  },
  setup(context) {
    const level = findLevel(context.props.levelId)!;
    const game = context.useStore(GameStore),
      { width, height, radius, speed } = playBounds;
    let run: number | undefined,
      elapsed = 0,
      finished = false;
    const ensureRun = () => (run ??= game.actions.beginRun(level.id));
    // The first fixed update only occurs after SceneManager commits this scene.
    context.scope.own(() => {
      if (run !== undefined) game.actions.endRun(run);
    });
    const player = context.create();
    context.world.set(player, Collector, { target: null });
    context.world.set(player, Position2D, { x: 80, y: height / 2 });
    context.world.set(player, Shape2D, {
      kind: 'circle',
      color: '#70d4b0',
      width: radius * 2,
      height: radius * 2,
      layer: 2,
    });
    context.world.set(player, Collider2D, { kind: 'circle', radius, group: 1, mask: 2 });
    for (let index = 0; index < level.targetCount; index++) {
      const item = context.create();
      context.world.set(item, Collectible, true);
      context.world.set(item, Position2D, {
        x: 180 + (index % 4) * 180,
        y: 90 + Math.floor(index / 4) * 110,
      });
      context.world.set(item, Shape2D, {
        kind: 'rect',
        color: '#ffd776',
        width: 20,
        height: 20,
        layer: 1,
      });
      context.world.set(item, Collider2D, {
        kind: 'rect',
        width: 20,
        height: 20,
        group: 2,
        mask: 1,
      });
    }
    const finish = (reason: RunOutcome) => {
      if (finished) return;
      finished = true;
      timeout.cancel();
      game.actions.finishRun(ensureRun(), reason);
    };
    const timeout = context.clock.after(level.durationSeconds, () => finish('timeout'));
    context.addSystem({
      id: 'collect-rules',
      update({ delta }) {
        if (finished) return;
        const session = ensureRun();
        if (game.state.phase() !== 'playing') return;
        elapsed = Math.min(level.durationSeconds, elapsed + delta);
        game.actions.updateRemaining(session, Math.max(0, level.durationSeconds - elapsed));
        const position = context.world.require(player, Position2D),
          movement = context.world.require(player, Collector);
        const pointer = context.actions.pointer;
        if (pointer.pressed && pointer.point?.inside)
          movement.target = {
            x: Math.max(radius, Math.min(width - radius, pointer.point.x)),
            y: Math.max(radius, Math.min(height - radius, pointer.point.y)),
          };
        let x = context.actions.axes.horizontal,
          y = context.actions.axes.vertical;
        if (x || y) movement.target = null;
        else if (movement.target) {
          x = movement.target.x - position.x;
          y = movement.target.y - position.y;
        }
        const length = Math.hypot(x, y);
        if (length) {
          const distance = movement.target ? Math.min(speed * delta, length) : speed * delta;
          position.x = Math.max(
            radius,
            Math.min(width - radius, position.x + (x / length) * distance),
          );
          position.y = Math.max(
            radius,
            Math.min(height - radius, position.y + (y / length) * distance),
          );
          if (movement.target && distance === length) movement.target = null;
        }
        for (const pair of detectCollisions(context.world)) {
          const item = pair.a === player ? pair.b : pair.b === player ? pair.a : null;
          if (item && context.world.has(item, Collectible)) {
            context.world.destroy(item);
            game.actions.collect(session);
          }
        }
        if (game.state.score() >= level.targetCount) finish('cleared');
      },
    });
  },
  onPause(context) {
    for (const entity of context.world.query(Collector))
      context.world.require(entity, Collector).target = null;
  },
});
