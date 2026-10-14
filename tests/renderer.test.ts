import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  Camera2D,
  Transform2D,
  Sprite2D,
  Animation2D,
  animationModule,
  createTransformResolver,
  transformPoint,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
test('parent transforms, camera roundtrips and invalid hierarchies', () => {
  const world = new World(),
    parent = world.create(),
    child = world.create();
  world.set(parent, Transform2D, { x: 10, y: 20, rotation: Math.PI / 2 });
  world.set(child, Transform2D, { x: 5, y: 0, parent });
  const result = transformPoint(createTransformResolver(world)(child), { x: 0, y: 0 });
  assert(Math.abs(result.x - 10) < 1e-10);
  assert(Math.abs(result.y - 25) < 1e-10);
  const camera = new Camera2D(10, 20, 2, 0.25),
    point = { x: 12, y: 24 };
  const roundtrip = camera.screenToWorld(camera.worldToScreen(point));
  assert(Math.abs(roundtrip.x - point.x) < 1e-10);
  assert(Math.abs(roundtrip.y - point.y) < 1e-10);
  world.require(parent, Transform2D).parent = child;
  assert.throws(() => createTransformResolver(world)(child), /cycle/);
  delete world.require(parent, Transform2D).parent;
  world.destroy(parent);
  assert.throws(() => createTransformResolver(world)(child), /Stale/);
  world.dispose();
});
test('animation uses fixed steps, pauses, and finishes non-looping clips', () => {
  const engine = new Engine({ tickRate: 2 }),
    entity = engine.world.create();
  const frames = [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 16, y: 0, width: 16, height: 16 },
  ];
  engine.world.set(entity, Sprite2D, { image: {} as CanvasImageSource, width: 16, height: 16 });
  engine.world.set(entity, Animation2D, { frames, fps: 2, loop: false });
  engine.install([animationModule()]);
  engine.start();
  engine.advance(0.5);
  assert.equal(engine.world.require(entity, Sprite2D).frame, frames[1]);
  engine.pause();
  engine.advance(10);
  assert.equal(engine.world.require(entity, Animation2D).elapsed, 0.5);
  engine.resume();
  engine.advance(0.5);
  assert.equal(engine.world.require(entity, Animation2D).playing, false);
  engine.dispose();
});
