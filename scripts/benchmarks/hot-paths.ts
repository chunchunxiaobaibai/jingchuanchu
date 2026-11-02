import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Collider2D, detectCollisions } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { ActionSampler, defineActions } from '../../packages/app/runtime/input-actions.js';

let checksum = 0;
const results: Array<{
  name: string;
  batch: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
}> = [];
function measure(name: string, batch: number, run: () => number) {
  const execute = () => {
    for (let i = 0; i < batch; i++) checksum += run();
  };
  for (let i = 0; i < 5; i++) execute();
  const samples: number[] = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    execute();
    samples.push((performance.now() - start) / batch);
  }
  samples.sort((a, b) => a - b);
  results.push({ name, batch, medianMs: samples[10]!, p95Ms: samples[19]!, minMs: samples[0]! });
}
for (const size of [1000, 10000]) {
  const world = new World();
  const tokens = Array.from({ length: 4 }, (_, index) => component<number>(String(index)));
  const handles = Array.from({ length: size }, (_, index) => {
    const entity = world.create();
    for (const token of tokens) world.set(entity, token, index);
    return entity;
  });
  for (const count of [0, 1, 4]) {
    const selected = tokens.slice(0, count);
    measure(`query:${size}:${count}`, 20, () => {
      let sum = 0;
      for (const entity of world.query(...selected)) sum += entity.index;
      assert.equal(sum, (size * (size - 1)) / 2);
      return sum;
    });
  }
  measure(`require:${size}`, 20, () => {
    let sum = 0;
    for (const entity of handles) sum += world.require(entity, tokens[0]!);
    assert.equal(sum, (size * (size - 1)) / 2);
    return sum;
  });
  world.dispose();
}
for (const held of [false, true]) {
  const sampler = new ActionSampler(
    defineActions({
      x: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] },
      y: { kind: 'axis', negative: ['KeyW'], positive: ['KeyS'] },
      fire: { kind: 'button', keys: ['Space'], pointer: 'primary' },
    }),
  );
  if (held) {
    sampler.setKey('KeyD', true);
    sampler.setKey('Space', true);
    sampler.setVirtual('x', -0.5, 'stick');
    sampler.setPointer({ x: 20, y: 30, inside: true }, true);
  }
  sampler.read();
  measure(`actions:${held ? 'held' : 'idle'}`, 1000, () => {
    const value = sampler.read();
    return value.axes.x + Number(value.buttons.fire.down) + (value.pointer.point?.x ?? 0);
  });
  const final = sampler.read();
  assert.equal(final.axes.x, held ? 0.5 : 0);
  assert.equal(final.buttons.fire.down, held);
  assert.equal(final.buttons.fire.pressed, false);
  sampler.dispose();
}
for (const sameX of [false, true]) {
  const world = new World();
  for (let i = 0; i < 1000; i++) {
    const entity = world.create();
    world.set(entity, Position2D, { x: sameX ? 0 : i * 20, y: sameX ? i * 20 : 0 });
    world.set(entity, Collider2D, { kind: 'rect', width: 10, height: 10 });
  }
  assert.equal(detectCollisions(world).length, 0);
  measure(`collision:1000:${sameX ? 'same-x' : 'sparse'}`, 5, () => {
    const pairs = detectCollisions(world);
    assert.equal(pairs.length, 0);
    return world.size + pairs.length;
  });
  world.dispose();
}
const sources: Record<string, string> = {};
for (const file of [
  'packages/ecs/index.ts',
  'packages/app/runtime/input-actions.ts',
  'packages/renderer-2d/collision.ts',
])
  sources[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const output = {
  node: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  samples: 21,
  warmupBatches: 5,
  units: 'milliseconds per operation; p95 of batch averages, not individual browser frames',
  sources,
  checksum,
  results,
};
if (process.argv[2]) {
  await mkdir(dirname(process.argv[2]), { recursive: true });
  await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
}
console.log(JSON.stringify(output, null, 2));
