import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
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
