import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import {
  defineGameScene,
  defineActions,
  GameSceneError,
  type GameSceneAccess,
  type GameClock,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { adaptGameScene } from '../packages/app/runtime/game-scene.js';
import { ActionSampler } from '../packages/app/runtime/input-actions.js';

const definitions = defineActions({ fire: { kind: 'button', keys: ['Space'] } });
function fixture() {
  const engine = new Engine({ tickRate: 10 }),
    scenes = new SceneManager(engine),
    sampler = new ActionSampler(definitions);
  let reads = 0;
  const services: GameSceneAccess & { readActions: () => ReturnType<typeof sampler.read> } = {
    assets: {
      load: async () => {
        throw new Error('Not configured in this fixture');
      },
    },
    useStore() {
      throw new Error('Not configured in this fixture');
    },
    useTheme() {
      throw new Error('Not configured in this fixture');
    },
    readActions() {
      reads++;
      return sampler.read();
    },
  };
  return { engine, scenes, sampler, services, reads: () => reads };
}

test('adapted scene owns clock/systems/entities and a restart creates a new scope without accumulating systems', async () => {
  const f = fixture();
  const clocks: GameClock[] = [];
  let cleanups = 0,
    timers = 0,
    ticks = 0,
    paused = 0,
    resumed = 0;
  const events: boolean[] = [];
  const props = { level: 2 };
  const scene = defineGameScene({
    id: 'play',
    actions: definitions,
    prepare: async (_signal: CancellationSignal, input: Readonly<{ level: number }>) => ({
      level: input.level,
    }),
    setup(context) {
      assert.equal(context.props.level, 2);
      assert.equal(context.prepared.level, 2);
      assert.equal(context.world, f.engine.world);
      assert.equal('host' in context, false);
      assert.equal(Reflect.set(context.props, 'level', 7), false);
      context.create();
      clocks.push(context.clock);
      context.clock.every(0.1, () => timers++);
      context.scope.own(() => cleanups++);
      context.addSystem({
        id: 'rules',
        order: -100,
        update() {
          ticks++;
          events.push(context.actions.buttons.fire.pressed);
          assert.equal(timers, ticks);
        },
      });
    },
    onPause(context) {
      paused++;
      assert.equal(context.actions.buttons.fire.down, false);
    },
    onResume() {
      resumed++;
    },
  });
  try {
    const first = adaptGameScene(scene, props, () => f.services);
    props.level = 99;
    await f.scenes.switchTo(first);
    assert.equal(f.engine.world.size, 1);
    f.engine.start();
    f.sampler.setKey('Space', true);
    f.engine.advance(0.1);
    f.engine.advance(0.1);
    assert.deepEqual(events, [true, false]);
    assert.equal(f.reads(), 2);
    f.scenes.pause();
    f.engine.advance(1);
    assert.equal(ticks, 2);
    f.scenes.resume();
    f.engine.advance(0.1);
    assert.equal(ticks, 3);
    assert.equal(paused, 1);
    assert.equal(resumed, 1);
    await f.scenes.switchTo(adaptGameScene(scene, { level: 2 }, () => f.services));
    assert.equal(cleanups, 1);
    assert.equal(clocks[0]!.disposed, true);
    assert.equal(clocks[1]!.disposed, false);
    assert.equal(f.engine.getSystems().length, 2);
    assert.equal(f.engine.world.size, 1);
    f.engine.advance(0.1);
    assert.equal(ticks, 4);
    assert.equal(clocks.length, 2);
  } finally {
    f.engine.dispose();
  }
  assert.equal(cleanups, 2);
  assert.equal(clocks[1]!.disposed, true);
});

test('failed prepare/setup retain the committed scene and destroy candidate scope/clock', async () => {
  const f = fixture();
  let ticks = 0,
    released = 0,
    candidateClock: GameClock | undefined;
  const live = defineGameScene({
    id: 'live',
    setup(context) {
      context.addSystem({
        id: 'tick',
        update() {
          ticks++;
        },
      });
    },
  });
  const noActions = {
    ...f.services,
    readActions: () => new ActionSampler(defineActions({})).read(),
  };
  try {
    await f.scenes.switchTo(adaptGameScene(live, {}, () => noActions));
    const broken = defineGameScene({
      id: 'broken',
      prepare() {
        throw new Error('load');
      },
      setup() {
        assert.fail('must not setup');
      },
    });
    await assert.rejects(
      f.scenes.switchTo(adaptGameScene(broken, {}, () => noActions)),
      (error: unknown) =>
        error instanceof GameSceneError &&
        error.source === 'broken' &&
        error.operation === 'prepare',
    );
    assert.equal(f.scenes.id, 'live');
    const failed = defineGameScene({
      id: 'failed-setup',
      setup(context) {
        candidateClock = context.clock;
        context.create();
        context.scope.own(() => released++);
        context.addSystem({
          id: 'never',
          update() {
            assert.fail('uncommitted');
          },
        });
        throw new Error('setup');
      },
    });
    await assert.rejects(
      f.scenes.switchTo(adaptGameScene(failed, {}, () => noActions)),
      GameSceneError,
    );
    assert.equal(candidateClock!.disposed, true);
    assert.equal(released, 1);
    assert.equal(f.scenes.id, 'live');
    assert.equal(f.engine.world.size, 0);
    assert.equal(f.engine.getSystems().length, 2);
    f.engine.start();
    f.engine.advance(0.1);
    assert.equal(ticks, 1);
  } finally {
    f.engine.dispose();
  }
});

test('owner exit cancels pending preparation and late results never setup; definitions remain reusable', async () => {
  const f = fixture();
  let finish!: (value: number) => void,
    signal: CancellationSignal | undefined,
    setups = 0;
  const slow = defineGameScene({
    id: 'slow',
    prepare(input: CancellationSignal) {
      signal = input;
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    },
    setup() {
      setups++;
    },
  });
  const noActions = {
    ...f.services,
    readActions: () => new ActionSampler(defineActions({})).read(),
  };
  const transition = f.scenes.switchTo(adaptGameScene(slow, {}, () => noActions));
  const outcome = transition.then(
    () => false,
    () => true,
  );
  f.engine.dispose();
  assert.equal(await outcome, true);
  assert.equal(signal!.aborted, true);
  finish(3);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(setups, 0);
  assert.equal(Object.isFrozen(slow), true);
});
