import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
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
