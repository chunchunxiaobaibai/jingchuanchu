import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';

// Compare identical work in one process. This measures JS only: no rasterization,
// GPU, DOM layout, requestAnimationFrame, input latency, or browser frame rate.
const frames = 30;
const samples = 21;
let sink = 0;
function measurePair(native: () => void, engine: () => void) {
  const timings = { native: [] as number[], engine: [] as number[] };
  for (let i = 0; i < 8; i++) {
    native();
    engine();
  }
  for (let i = 0; i < samples; i++) {
    const order = i % 2 ? (['engine', 'native'] as const) : (['native', 'engine'] as const);
    for (const name of order) {
      const start = performance.now();
      for (let frame = 0; frame < frames; frame++) (name === 'native' ? native : engine)();
      timings[name].push((performance.now() - start) / frames);
    }
  }
  const stats = (values: number[]) => {
    values.sort((a, b) => a - b);
    return { medianMs: values[10]!, p95Ms: values[19]!, minMs: values[0]! };
  };
  const a = stats(timings.native),
    b = stats(timings.engine);
  return { native: a, engine: b, engineOverNative: b.medianMs / a.medianMs };
}

const results = [];
for (const size of [100, 1000, 10000]) {
  const world = new World();
  const objects = Array.from({ length: size }, (_, index) => {
    const position = { x: index % 960, y: index % 600 };
    const shape = { kind: 'rect' as const, color: '#fff', width: 10, height: 10, layer: index % 7 };
    const entity = world.create();
    world.set(entity, Position2D, { ...position });
    world.set(entity, Shape2D, shape);
    return { position, shape };
  });
  const movement = measurePair(
    () => {
      for (const { position } of objects) {
        position.x += 0.25;
        position.y += 0.5;
        sink += position.x;
      }
    },
    () => {
      for (const entity of world.query(Position2D)) {
        const position = world.require(entity, Position2D);
        position.x += 0.25;
        position.y += 0.5;
        sink += position.x;
      }
    },
  );
  assert.deepEqual(
    [...world.query(Position2D)].map((entity) => world.require(entity, Position2D)),
    objects.map((object) => object.position),
  );

  let checksum = 0,
    calls = 0;
  const context = {
    fillStyle: '',
    setTransform() {},
    fillRect(x: number, y: number, width: number, height: number) {
      // Order-sensitive observation prevents an unused/no-op drawing benchmark.
      checksum = (checksum * 31 + x + y + width + height) % 10000019;
      calls++;
    },
  };
  const renderer = new Canvas2D(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    960,
    600,
    1,
  );
  const nativeDraw = () => {
    // Preserve the engine's per-frame stable layer sorting and style writes.
    const sorted = objects.slice().sort((a, b) => a.shape.layer - b.shape.layer);
    for (const { shape, position } of sorted) {
      context.fillStyle = shape.color;
      context.fillRect(position.x, position.y, shape.width, shape.height);
    }
  };
  nativeDraw();
  const expected = { checksum, calls };
  checksum = calls = 0;
  renderer.drawWorld(world);
  assert.deepEqual({ checksum, calls }, expected);
  const draw = measurePair(nativeDraw, () => renderer.drawWorld(world));
  sink += checksum + calls;
  results.push({ size, movement, draw });
  world.dispose();
}
const output = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  samples,
  framesPerSample: frames,
  units: 'milliseconds per iteration; p95 is over batch averages, not individual frames',
  scope: 'Node JS traversal/update/layer-sort/mock Canvas submission only',
  sink,
  results,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
