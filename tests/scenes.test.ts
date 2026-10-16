import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';

for (const action of ['switch', 'dispose'] as const)
  test(`scene preparation settles on ${action} even when the loader ignores cancellation`, async () => {
    const engine = new Engine();
    const scenes = new SceneManager(engine);
    let rejectLoad!: (reason: unknown) => void;
    let setups = 0;
    const pending = scenes.switchTo({
      id: 'slow',
      prepare: () =>
        new Promise<void>((_, reject) => {
          rejectLoad = reject;
        }),
      setup() {
        setups++;
      },
    });
    const outcome = pending.then(
      () => 'activated',
      () => 'cancelled',
    );
    try {
      if (action === 'switch') await scenes.switchTo({ id: 'next', setup() {} });
      else scenes.dispose();
      assert.equal(
        await Promise.race([
          outcome,
          new Promise<string>((resolve) => setImmediate(() => resolve('pending'))),
        ]),
        'cancelled',
      );
      // A late failure must remain handled after the transition has already rejected.
      rejectLoad(new Error('late load failure'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(setups, 0);
      assert.equal(scenes.id, action === 'switch' ? 'next' : undefined);
    } finally {
      engine.dispose();
    }
  });

test('scenes own entities and systems, preserve old scenes on failure and dispose superseded preparation', async () => {
  const engine = new Engine(),
    scenes = new SceneManager(engine);
  let ticks = 0,
    cleanups = 0;
  await scenes.switchTo({
    id: 'a',
    setup(context) {
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
  engine.start();
  engine.advance(engine.step);
  assert.equal(ticks, 1);
  scenes.pause();
  engine.advance(engine.step);
  assert.equal(ticks, 1);
  scenes.resume();
  await assert.rejects(
    scenes.switchTo({
      id: 'bad',
      setup(context) {
        context.create();
        throw new Error('setup');
      },
    }),
  );
  assert.equal(scenes.id, 'a');
  assert.equal(engine.world.size, 1);
  let release!: () => void;
  const pending = scenes.switchTo({
    id: 'slow',
    prepare: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    setup(context) {
      context.create();
    },
  });
  await scenes.switchTo({
    id: 'b',
    setup(context) {
      context.create();
    },
  });
  release();
  await assert.rejects(pending);
  assert.equal(scenes.id, 'b');
  assert.equal(engine.world.size, 1);
  assert.equal(cleanups, 1);
  for (let i = 0; i < 20; i++)
    await scenes.switchTo({
      id: String(i),
      setup(context) {
        context.create();
        context.addSystem({ id: 'tick', update() {} });
      },
    });
  assert.equal(engine.world.size, 1);
  assert.equal(engine.getSystems().length, 1);
  engine.dispose();
  assert.equal(engine.world.size, 0);
});
