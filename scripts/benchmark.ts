import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
const results: Array<{ name: string; medianMs: number; minMs: number; maxMs: number }> = [];
function measure(name: string, run: () => void) {
  for (let i = 0; i < 5; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  results.push({ name, medianMs: samples[7]!, minMs: samples[0]!, maxMs: samples[14]! });
}
let checksum = 0;
for (const size of [100, 1000, 10000]) {
  const world = new World();
  const tokens = Array.from({ length: 4 }, (_, i) => component<number>(String(i)));
  for (let i = 0; i < size; i++) {
    const entity = world.create();
    for (const token of tokens) world.set(entity, token, i);
  }
  for (const count of [1, 2, 4])
    measure(`query:${size}:${count}`, () => {
      for (let j = 0; j < 20; j++)
        for (const entity of world.query(...tokens.slice(0, count))) checksum += entity.index;
    });
  world.dispose();
}
for (const diagnostics of [true, false]) {
  const engine = new Engine({ tickRate: 60, diagnostics });
  for (let i = 0; i < 1000; i++)
    engine.addSystem({
      id: String(i),
      phase: i % 2 ? 'render' : 'fixed',
      update() {
        checksum++;
      },
    });
  engine.start();
  measure(`systems:1000:diagnostics=${diagnostics}`, () => {
    for (let i = 0; i < 100; i++) engine.advance(engine.step);
  });
  engine.dispose();
}
// Mock Canvas isolates JS traversal/sorting cost; it does not measure browser GPU/Canvas rendering.
const original = globalThis.window;
globalThis.window = { devicePixelRatio: 1 } as Window & typeof globalThis;
const context = { setTransform() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} };
const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
const renderer = new Canvas2D(canvas);
for (const size of [100, 1000]) {
  const world = new World();
  for (let i = 0; i < size; i++) {
    const e = world.create();
    world.set(e, Position2D, { x: i % 960, y: i % 600 });
    world.set(e, Shape2D, { kind: 'rect', color: '#fff', width: 10, height: 10, layer: i % 7 });
  }
  measure(`draw-js:${size}`, () => {
    for (let j = 0; j < 20; j++) renderer.drawWorld(world);
  });
  world.dispose();
}
globalThis.window = original;
const output = {
  node: process.version,
  platform: process.platform,
  units: 'milliseconds per batch',
  samples: 15,
  checksum,
  results,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
