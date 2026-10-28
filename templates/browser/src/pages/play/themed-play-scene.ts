import {
  defineGameScene,
  type ThemeImageLease,
  type AudioControls,
  type TweenHandle,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Sprite2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import { GameStore, type RunOutcome } from '../../game/session/game-store.js';
import { PlayScene, Collector, Collectible, playBounds } from './play-scene.js';

export interface PlayFeedback {
  collected(audio: AudioControls, run: number): void;
  finished(outcome: RunOutcome, run: number): void;
}

/** Page-owned image stays outside serializable scene props and game Stores. */
export function createThemedPlayScene(
  icon: ThemeImageLease,
  playerColor: string,
  feedback?: PlayFeedback,
) {
  return defineGameScene({
    ...PlayScene,
    setup(context) {
      PlayScene.setup(context);
      for (const entity of context.world.query(Collector))
        context.world.require(entity, Shape2D).color = playerColor;
      for (const entity of context.world.query(Collectible)) {
        context.world.remove(entity, Shape2D);
        context.world.set(entity, Sprite2D, {
          image: icon.image.source,
          width: 20,
          height: 20,
          layer: 1,
          ...(icon.kind === 'atlas-region' ? { frame: { ...icon.frame } } : {}),
        });
      }
      const game = context.useStore(GameStore);
      const player = [...context.world.query(Collector)][0]!;
      const shape = context.world.require(player, Shape2D);
      let lastRun = 0,
        lastScore = 0,
        completedRun = 0;
      let pulse: TweenHandle | undefined;
      context.addSystem({
        id: 'collect-feedback',
        after: ['collect-rules'],
        update() {
          if (game.state.sessionLevelId() !== context.props.levelId) return;
          const run = game.state.runId(),
            score = game.state.score();
          if (run !== lastRun) {
            lastRun = run;
            lastScore = 0;
          }
          if (score > lastScore) {
            lastScore = score;
            pulse?.cancel();
            const diameter = playBounds.radius * 2;
            shape.width = shape.height = diameter * 1.35;
            pulse = context.clock.tween({
              from: 1.35,
              to: 1,
              duration: 0.18,
              easing: 'ease-out',
              onUpdate(value) {
                shape.width = shape.height = diameter * value;
              },
            });
            if (feedback) feedback.collected(context.audio, run);
          }
          if (game.state.phase() === 'finished' && completedRun !== run) {
            completedRun = run;
            const outcome = game.state.outcome();
            if (outcome) feedback?.finished(outcome, run);
          }
        },
      });
    },
  });
}
