import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, component, resource } from '@xiaobai/ecs';

test('reused index cannot be accessed by an old entity handle', () => {
  const world = new World();
  const Position = component<{ x: number }>('Position');
  const old = world.create();
  world.set(old, Position, { x: 1 });
  world.destroy(old);
  const next = world.create();
  world.set(next, Position, { x: 2 });
  assert.equal(old.index, next.index);
  assert.notEqual(old.generation, next.generation);
  assert.equal(world.get(old, Position), undefined);
  assert.equal(world.destroy(old), false);
  assert.throws(() => world.set(old, Position, { x: 3 }));
  assert.equal(world.require(next, Position).x, 2);
});

test('entities belong to a single world even when indices and generations match', () => {
  const a = new World();
  const b = new World();
  const Value = component<number>('Value');
  const foreign = a.create();
  const local = b.create();
  b.set(local, Value, 42);
  assert.equal(b.isAlive(foreign), false);
  assert.equal(b.get(foreign, Value), undefined);
  assert.equal(b.destroy(foreign), false);
  assert.throws(() => b.set(foreign, Value, 1));
  assert.equal(b.require(local, Value), 42);
});

test('intersection queries survive swap removals and deferred changes', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');
  const entities = Array.from({ length: 100 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
    if (i % 2 === 0) world.set(entity, B, true);
  });
  for (const entity of world.query(A, B)) world.defer((w) => w.destroy(entity));
  assert.equal(world.size, 100);
  world.flush();
  assert.equal(world.size, 50);
  assert.equal([...world.query(A, B)].length, 0);
  assert.deepEqual(
    [...world.query(A)].map((e) => world.require(e, A)).sort((a, b) => a - b),
    entities.map((_, i) => i).filter((i) => i % 2),
  );
});

test('query snapshots do not visit recycled entities; resources and disposal work', () => {
  const world = new World();
  const A = component<number>('A');
  const first = world.create();
  const second = world.create();
  world.set(first, A, 1);
  world.set(second, A, 2);
  const iterator = world.query(A);
  assert.equal(iterator.next().value?.index, first.index);
  world.destroy(second);
  const replacement = world.create();
  world.set(replacement, A, 3);
  assert.equal(iterator.next().done, true);
  const Clock = resource<number>('Clock');
  world.setResource(Clock, 42);
  assert.equal(world.getResource(Clock), 42);
  world.dispose();
  assert.equal(world.size, 0);
  assert.throws(() => world.create());
});
