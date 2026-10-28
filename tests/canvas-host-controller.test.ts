import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineGameScene,
  defineActions,
  type GameSceneDefinition,
  type GameSceneAccess,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import {
  createCanvasHostController,
  CanvasHostError,
} from '../packages/app/runtime/canvas-host.js';
import {
  ActionSampler,
  type ActionEntries,
  type ActionDefinitions,
  type ActionSnapshot,
} from '../packages/app/runtime/input-actions.js';

function services<P, D, A extends ActionEntries>(
  definition: GameSceneDefinition<P, D, A>,
): GameSceneAccess & { readActions(): ActionSnapshot<A> } {
  const sampler = new ActionSampler(
    definition.actions ?? (defineActions({}) as ActionDefinitions<A>),
  );
  return {
    assets: {
      async load() {
        throw new Error('No transport in this fixture');
      },
    },
    useStore() {
      throw new Error('No stores in this fixture');
    },
    useTheme() {
      throw new Error('No theme in this fixture');
    },
    readActions: () => sampler.read(),
  };
}
function fixture() {
  const scope = new Scope(),
    frames = new Map<number, (time: number) => void>(),
    listeners = new Set<() => void>();
  let nextId = 0,
    hidden = false,
    enabled = false,
    clears = 0;
  const errors: CanvasHostError[] = [];
  const host = createCanvasHostController({
    scope,
    services,
    clock: { tickRate: 10 },
    onError: (error) => {
      errors.push(error);
    },
    input: {
      setActive(active) {
        enabled = active;
      },
      clear() {
        clears++;
      },
    },
    driver: {
      requestFrame(callback) {
        const id = ++nextId;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id) {
        frames.delete(id);
      },
      isHidden: () => hidden,
      subscribeVisibility(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
  });
  return {
    scope,
    host,
    frames,
    listeners,
    errors,
    enabled: () => enabled,
    clears: () => clears,
    hidden(value: boolean) {
      hidden = value;
      for (const callback of [...listeners]) callback();
    },
    frame(time: number) {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(time);
    },
  };
}

test('host starts one owned frame driver after commit, restarts from copied props and preserves distinct pause reasons', async () => {
  const f = fixture();
  let ticks = 0,
    cleanups = 0;
  const levels: number[] = [];
  const scene = defineGameScene({
    id: 'play',
    prepare: (_signal, props: Readonly<{ level: number }>) => props.level,
    setup(context) {
      levels.push(context.prepared);
      context.create();
      context.scope.own(() => cleanups++);
      context.addSystem({
        id: 'tick',
        update() {
          ticks++;
        },
      });
    },
  });
  const props = { level: 2 };
  assert.equal(f.frames.size, 0);
  assert.equal(f.enabled(), false);
  await f.host.switchTo(scene, props);
  props.level = 99;
  assert.equal(f.frames.size, 1);
  assert.equal(f.enabled(), true);
  f.frame(0);
  f.frame(100);
  assert.equal(ticks, 1);
  assert.equal(f.frames.size, 1);
  f.hidden(true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.enabled(), false);
  f.host.pause();
  f.hidden(false);
  assert.equal(f.host.engine.status, 'paused');
  assert.equal(f.frames.size, 0);
  f.host.resume();
  assert.equal(f.frames.size, 1);
  f.host.setActive(false);
  f.hidden(true);
  f.hidden(false);
  assert.equal(f.host.engine.status, 'paused');
  f.host.setActive(true);
  assert.equal(f.host.engine.status, 'running');
  f.host.engine.pause();
  f.hidden(true);
  f.hidden(false);
  assert.equal(f.host.engine.status, 'paused');
  f.host.engine.resume();
  assert.equal(f.host.engine.status, 'running');
  await f.host.restart();
  assert.deepEqual(levels, [2, 2]);
  assert.equal(cleanups, 1);
  assert.equal(f.host.engine.getSystems().length, 2);
  assert.equal(f.host.engine.world.size, 1);
  assert.equal(f.frames.size, 1);
  f.scope.dispose();
  f.host.dispose();
  assert.equal(cleanups, 2);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.enabled(), false);
  assert.equal(f.host.engine.status, 'disposed');
  assert.equal(f.host.disposed, true);
});

test('failed or superseded preparation preserves current restart target, owner exit cannot revive a late candidate', async () => {
  const f = fixture();
  let live = 0,
    lateSetups = 0,
    finish!: (value: void) => void;
  const good = defineGameScene({
    id: 'good',
    setup() {
      live++;
    },
  });
  const broken = defineGameScene({
    id: 'broken',
    prepare() {
      throw new Error('load failed');
    },
    setup() {
      assert.fail('broken');
    },
  });
  const slow = defineGameScene({
    id: 'slow',
    prepare: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    setup() {
      lateSetups++;
    },
  });
  await f.host.switchTo(good, {});
  await assert.rejects(f.host.switchTo(broken, {}), CanvasHostError);
  assert.equal(f.host.sceneId, 'good');
  assert.equal(f.host.preparing, false);
  assert.equal(f.frames.size, 1);
  await f.host.restart();
  assert.equal(live, 2);
  const superseded = f.host.switchTo(slow, {}).then(
    () => false,
    () => true,
  );
  await assert.rejects(f.host.switchTo(good, { bad: () => {} } as never), CanvasHostError);
  assert.equal(f.host.preparing, true);
  await f.host.switchTo(good, {});
  assert.equal(await superseded, true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(lateSetups, 0);
  assert.equal(f.host.sceneId, 'good');
  const pending = f.host.switchTo(slow, {}).then(
    () => false,
    () => true,
  );
  assert.equal(f.host.preparing, true);
  f.scope.dispose();
  assert.equal(await pending, true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(lateSetups, 0);
  assert.equal(f.frames.size, 0);
  await assert.rejects(f.host.switchTo(good, {}), CanvasHostError);
});

test('frame failure is reported once and visibility cannot restart a stopped Engine; hosts are isolated', async () => {
  const a = fixture(),
    b = fixture();
  const broken = defineGameScene({
    id: 'broken-frame',
    setup(context) {
      context.addSystem({
        id: 'fail',
        update() {
          throw new Error('frame');
        },
      });
    },
  });
  const normal = defineGameScene({ id: 'normal', setup() {} });
  await a.host.switchTo(broken, {});
  await b.host.switchTo(normal, {});
  a.frame(0);
  a.frame(100);
  assert.equal(a.errors.length, 1);
  assert.equal(a.errors[0]!.operation, 'frame');
  assert.equal(a.frames.size, 0);
  assert.equal(a.host.engine.status, 'stopped');
  assert.equal(a.enabled(), false);
  a.hidden(true);
  a.hidden(false);
  assert.equal(a.frames.size, 0);
  assert.equal(b.frames.size, 1);
  assert.equal(b.host.engine.status, 'running');
  a.scope.dispose();
  assert.equal(b.frames.size, 1);
  b.host.engine.dispose();
  assert.equal(b.host.disposed, true);
  assert.equal(b.frames.size, 0);
  assert.equal(b.listeners.size, 0);
  b.scope.dispose();
});
