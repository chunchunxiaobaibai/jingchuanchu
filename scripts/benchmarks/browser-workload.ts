import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';

function stats(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted.at(-1)!,
  };
}
async function scenario(size: number, mode: 'native' | 'engine') {
  // Isolate context state and Chrome's readback-dependent raster backend choice.
  const canvas = document.createElement('canvas');
  document.querySelector('canvas')!.replaceWith(canvas);
  const renderer = new Canvas2D(canvas, 960, 600, 1);
  const ctx = renderer.context;
  const world = new World();
  const objects = Array.from({ length: size }, (_, i) => {
    const position = { x: i % 950, y: (i * 7) % 590 };
    const shape = { kind: 'rect' as const, width: 10, height: 10, color: '#79bd9a', layer: i % 7 };
    const entity = world.create();
    world.set(entity, Position2D, { ...position });
    world.set(entity, Shape2D, shape);
    return { position, shape };
  });
  const update: number[] = [],
    draw: number[] = [],
    intervals: number[] = [];
  let previous = 0,
    count = 0;
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const started = performance.now();
      if (mode === 'native') {
        for (const { position } of objects) position.x = (position.x + 0.25) % 950;
      } else {
        for (const entity of world.query(Position2D)) {
          const position = world.require(entity, Position2D);
          position.x = (position.x + 0.25) % 950;
        }
      }
      const updated = performance.now();
      renderer.clear('#172031');
      if (mode === 'native') {
        const sorted = objects.slice().sort((a, b) => a.shape.layer - b.shape.layer);
        for (const { position, shape } of sorted) {
          ctx.fillStyle = shape.color;
          ctx.fillRect(position.x, position.y, shape.width, shape.height);
        }
      } else renderer.drawWorld(world);
      const drawn = performance.now();
      if (count >= 30) {
        update.push(updated - started);
        draw.push(drawn - updated);
        intervals.push(now - previous);
      }
      previous = now;
      if (++count < 150) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  // Read back once after measurement to compare actual rasterized pixels.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let pixelHash = 2166136261;
  for (const byte of pixels) pixelHash = Math.imul(pixelHash ^ byte, 16777619) >>> 0;
  world.dispose();
  return {
    size,
    mode,
    warmupFrames: 30,
    measuredFrames: 120,
    update: stats(update),
    drawSubmission: stats(draw),
    frameInterval: stats(intervals),
    intervalsOver25Ms: intervals.filter((n) => n > 25).length,
    pixelHash,
  };
}
async function run() {
  const results = [];
  // Reverse order in the second round to expose warmup/order variance.
  for (const round of [1, 2]) {
    for (const size of [1000, 10000]) {
      const modes = round === 1 ? (['native', 'engine'] as const) : (['engine', 'native'] as const);
      for (const mode of modes) results.push({ round, ...(await scenario(size, mode)) });
    }
  }
  for (const round of [1, 2]) {
    for (const size of [1000, 10000]) {
      const hashes = results
        .filter((r) => r.size === size && r.round === round)
        .map((r) => r.pixelHash);
      if (hashes[0] !== hashes[1])
        throw new Error('Raster output mismatch: ' + JSON.stringify(results));
    }
  }
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    results,
  };
}
(window as unknown as { performanceBenchmark: Promise<unknown> }).performanceBenchmark = run();
