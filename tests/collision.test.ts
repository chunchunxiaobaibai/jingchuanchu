import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Transform2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import {
  Collider2D,
  detectCollisions,
  collisionModule,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
test('circle/AABB detection, masks, enter/stay/exit and recycled handles', () => {
  const engine = new Engine(),
    a = engine.world.create(),
    b = engine.world.create();
  engine.world.set(a, Position2D, { x: 0, y: 0 });
  engine.world.set(a, Collider2D, { kind: 'rect', width: 10, height: 10 });
  engine.world.set(b, Position2D, { x: 15, y: 5 });
  engine.world.set(b, Collider2D, { kind: 'circle', radius: 5 });
  assert.equal(detectCollisions(engine.world).length, 1);
  const events: string[] = [];
  engine.install([
    collisionModule({
      onEnter: () => events.push('enter'),
      onStay: () => events.push('stay'),
      onExit: () => events.push('exit'),
    }),
  ]);
  engine.start();
  engine.advance(engine.step);
  engine.advance(engine.step);
  engine.world.require(b, Position2D).x = 20;
  engine.advance(engine.step);
  assert.deepEqual(events, ['enter', 'stay', 'exit']);
  engine.world.require(b, Collider2D).mask = 0;
  engine.world.require(b, Position2D).x = 5;
  assert.equal(detectCollisions(engine.world).length, 0);
  engine.world.require(b, Collider2D).mask = -1;
  engine.advance(engine.step);
  engine.world.destroy(b);
  engine.advance(engine.step);
  const recycled = engine.world.create();
  assert.equal(recycled.index, b.index);
  engine.world.set(recycled, Position2D, { x: 5, y: 5 });
  engine.world.set(recycled, Collider2D, { kind: 'circle', radius: 5 });
  engine.advance(engine.step);
  assert.equal(events.at(-1), 'enter');
  engine.dispose();
});

test('rectangle AABBs include parent rotation, negative scale and offsets without stale bounds', () => {
  const engine = new Engine(),
    world = engine.world;
  const parent = world.create(),
    rectangle = world.create(),
    point = world.create();
  world.set(parent, Transform2D, { x: 100, y: 50, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 });
  world.set(rectangle, Transform2D, { x: 5, y: 7, scaleX: -1, scaleY: 2, parent });
  world.set(rectangle, Collider2D, { kind: 'rect', width: 4, height: 6, offsetX: 2, offsetY: -1 });
  world.set(point, Position2D, { x: 60, y: 52 });
  world.set(point, Collider2D, { kind: 'circle', radius: 0 });
  try {
    assert.deepEqual(detectCollisions(world), [{ a: rectangle, b: point }]);
    world.require(rectangle, Collider2D).offsetX = 12;
    assert.deepEqual(detectCollisions(world), []);
    world.require(rectangle, Collider2D).offsetX = 2;
    world.require(parent, Transform2D).rotation = 0;
    assert.deepEqual(detectCollisions(world), []);
    world.require(parent, Transform2D).rotation = Math.PI / 2;
    assert.deepEqual(detectCollisions(world), [{ a: rectangle, b: point }]);
    world.destroy(parent);
    assert.throws(() => detectCollisions(world), /Stale transform parent/);
  } finally {
    engine.dispose();
  }
});

test('zero-size rectangles keep inclusive boundaries and invalid dimensions still reject', () => {
  const engine = new Engine(),
    world = engine.world;
  const a = world.create(),
    b = world.create();
  world.set(a, Position2D, { x: 10, y: 20 });
  world.set(a, Collider2D, { kind: 'rect', width: 0, height: 0 });
  world.set(b, Position2D, { x: 10, y: 20 });
  world.set(b, Collider2D, { kind: 'circle', radius: 0 });
  try {
    assert.deepEqual(detectCollisions(world), [{ a, b }]);
    const collider = world.require(a, Collider2D);
    assert.equal(collider.kind, 'rect');
    if (collider.kind !== 'rect') throw new Error('Expected rectangle');
    for (const bad of [-1, NaN, Infinity]) {
      collider.width = bad;
      assert.throws(() => detectCollisions(world), /Invalid collider dimensions/);
    }
    collider.width = 0;
    collider.height = -1;
    assert.throws(() => detectCollisions(world), /Invalid collider dimensions/);
  } finally {
    engine.dispose();
  }
});
