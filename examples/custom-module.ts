import { Engine, EventBus, type EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource } from '@xiaobaibaifqy/jingchuanchu-ecs';

export const Score = resource<{ value: number }>('GameScore');
export const scoringModule = (): EngineModule => ({
  id: 'game:scoring',
  setup(engine, scope) {
    const score = { value: 0 };
    const events = new EventBus<{ award: number }>();
    engine.provide(Score, score, scope);
    events.on(
      'award',
      (points) => {
        score.value += points;
      },
      scope,
    );
    scope.own(() => events.clear());
    engine.addSystem(
      {
        id: 'game:score-tick',
        update() {
          events.emit('award', 1);
        },
      },
      scope,
    );
  },
});
const engine = new Engine();
engine.install([scoringModule()]);
engine.start();
engine.advance(engine.step);
if (engine.world.getResource(Score).value !== 1) throw new Error('Scoring module failed');
console.log('Score after one step:', engine.world.getResource(Score).value);
engine.dispose();
