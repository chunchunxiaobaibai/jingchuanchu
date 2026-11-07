import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, component, type Entity } from '@xiaobaibaifqy/jingchuanchu-ecs';

test('bulkQuery returns iterator with reusable buffer', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');
  const entities = Array.from({ length: 10 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
    if (i % 2 === 0) world.set(entity, B, true);
  });

  const iterator = world.bulkQuery(A);
  const firstBuffer = iterator.next().value;
  assert(firstBuffer !== undefined);
  const bufferRef = firstBuffer.buffer;
  assert(Array.isArray(bufferRef));
  assert.equal(bufferRef.length, 10);

  // Verify second iteration reuses same buffer reference
  const secondBuffer = iterator.next().value;
  assert.equal(secondBuffer?.buffer, bufferRef);
  iterator.return?.();
});

test('bulkQuery with multiple tokens returns intersection', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');
  const C = component<string>('C');

  const entities = Array.from({ length: 10 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
    if (i % 2 === 0) world.set(entity, B, true);
    if (i % 3 === 0) world.set(entity, C, `${i}`);
  });

  // A ∩ B: entities 0, 2, 4, 6, 8 (5 entities)
  const iterator = world.bulkQuery(A, B);
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);
  assert.equal(buffer.length, 5);

  // Verify correct entities (0, 2, 4, 6, 8)
  const indices = buffer.map((e: Entity) => e.index).sort((a: number, b: number) => a - b);
  assert.deepEqual(indices, [0, 2, 4, 6, 8]);

  iterator.return?.();
});

test('bulkQuery with empty result', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');

  const entities = Array.from({ length: 5 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
  });

  // No entities have B
  const iterator = world.bulkQuery(A, B);
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);
  assert.equal(buffer.length, 0);

  iterator.return?.();
});

test('bulkQuery with single component', () => {
  const world = new World();
  const A = component<number>('A');

  const entities = Array.from({ length: 20 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
  });

  const iterator = world.bulkQuery(A);
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);
  assert.equal(buffer.length, 20);

  iterator.return?.();
});

test('bulkQuery throws on component modification during iteration', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');

  const entities = Array.from({ length: 5 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
  });

  const iterator = world.bulkQuery(A);
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);

  // Try to modify components during iteration
  if (buffer.length > 0) {
    assert.throws(
      () => {
        world.set(buffer[0]!, B, true);
      },
      /Cannot modify components during bulkQuery iteration/
    );
  }

  iterator.return?.();
});

test('bulkQuery snapshot does not visit recycled entities', () => {
  const world = new World();
  const A = component<number>('A');

  const first = world.create();
  const second = world.create();
  world.set(first, A, 1);
  world.set(second, A, 2);

  const iterator = world.bulkQuery(A);
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);
  assert.equal(buffer.length, 2);

  // Clean up iterator before modifying
  iterator.return?.();

  // Destroy and recreate
  world.destroy(second);
  const replacement = world.create();
  world.set(replacement, A, 3);

  // Buffer should still have snapshot from when iterator was created
  assert.equal(buffer.length, 2);
});

test('bulkQuery with no tokens returns all entities', () => {
  const world = new World();
  const A = component<number>('A');

  const entities = Array.from({ length: 8 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
  });

  // Create entities without A
  world.create();
  world.create();

  const iterator = world.bulkQuery();
  const buffer = iterator.next().value?.buffer;
  assert(buffer !== undefined);
  assert.equal(buffer.length, 10);

  iterator.return?.();
});

test('bulkQuery disposed world throws', () => {
  const world = new World();
  const A = component<number>('A');

  world.dispose();

  assert.throws(
    () => {
      world.bulkQuery(A);
    },
    /World is disposed/
  );
});

test('bulkQuery performance vs query (sanity check)', () => {
  const world = new World();
  const A = component<number>('A');
  const B = component<boolean>('B');

  const entities = Array.from({ length: 1000 }, () => world.create());
  entities.forEach((entity, i) => {
    world.set(entity, A, i);
    if (i % 2 === 0) world.set(entity, B, true);
  });

  // Test that bulkQuery iteration works correctly
  const bulkIterator = world.bulkQuery(A, B);
  const bulkBuffer = bulkIterator.next().value?.buffer;
  assert(bulkBuffer !== undefined);

  let bulkSum = 0;
  for (const entity of bulkBuffer) {
    bulkSum += world.require(entity, A);
  }

  // Compare with query
  let querySum = 0;
  for (const entity of world.query(A, B)) {
    querySum += world.require(entity, A);
  }

  assert.equal(bulkSum, querySum);

  bulkIterator.return?.();
  world.dispose();
});
