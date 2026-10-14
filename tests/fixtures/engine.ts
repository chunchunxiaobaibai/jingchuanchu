import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import {
  Transform2D,
  Camera2D,
  Sprite2D,
  Animation2D,
  animationModule,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new Canvas2D(canvas, 64, 32);
renderer.resize(64, 32, 2);
const atlas = document.createElement('canvas');
atlas.width = 32;
atlas.height = 16;
const context = atlas.getContext('2d')!;
context.fillStyle = '#0000ff';
context.fillRect(0, 0, 16, 16);
context.fillStyle = '#ff0000';
context.fillRect(16, 0, 16, 16);
const engine = new Engine({ tickRate: 2 }),
  entity = engine.world.create();
engine.world.set(entity, Transform2D, { x: 10, y: 0 });
engine.world.set(entity, Sprite2D, {
  image: atlas,
  width: 16,
  height: 16,
  frame: { x: 0, y: 0, width: 16, height: 16 },
});
engine.world.set(entity, Animation2D, {
  fps: 2,
  frames: [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 16, y: 0, width: 16, height: 16 },
  ],
});
engine.install([animationModule()]);
const camera = new Camera2D(10, 0, 1);
renderer.clear();
renderer.drawWorld(engine.world, camera);
const blue = renderer.context.getImageData(2, 2, 1, 1).data;
if (blue[2] !== 255 || blue[0] !== 0) throw new Error('Atlas/camera rendering failed');
engine.start();
engine.advance(0.5);
renderer.clear();
renderer.drawWorld(engine.world, camera);
const red = renderer.context.getImageData(2, 2, 1, 1).data;
if (red[0] !== 255 || red[2] !== 0) throw new Error('Animated atlas frame failed');
engine.pause();
engine.advance(10);
if (engine.world.require(entity, Animation2D).elapsed !== 0.5)
  throw new Error('Paused animation advanced');
engine.world.require(entity, Sprite2D).flipX = true;
engine.world.require(entity, Sprite2D).anchorX = 1;
renderer.clear();
renderer.drawWorld(engine.world, camera);
if (renderer.context.getImageData(2, 2, 1, 1).data[0] !== 255)
  throw new Error('Sprite flipping failed');
const rect = canvas.getBoundingClientRect(),
  point = renderer.toWorldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, camera);
if (Math.abs(point.x - 42) > 1e-8 || Math.abs(point.y - 16) > 1e-8)
  throw new Error('Pointer mapping failed');
engine.dispose();
// Real Canvas CPU submission timings, including a readback per batch.
function measure(
  Renderer: typeof Canvas2D,
  WorldClass: typeof World,
  position: typeof Position2D,
  shape: typeof Shape2D,
) {
  const canvas = document.createElement('canvas'),
    renderer = new Renderer(canvas, 64, 32),
    world = new WorldClass();
  for (let i = 0; i < 1000; i++) {
    const entity = world.create();
    world.set(entity, position, { x: i % 64, y: i % 32 });
    world.set(entity, shape, { kind: 'rect', color: '#123456', width: 2, height: 2, layer: i % 7 });
  }
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    for (let j = 0; j < 20; j++) renderer.drawWorld(world);
    renderer.context.getImageData(0, 0, 1, 1);
    if (i >= 5) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  world.dispose();
  return { medianMs: samples[7], minMs: samples[0], maxMs: samples[14] };
}
const rendererPath = '/tests/fixtures/baseline/renderer.js',
  ecsPath = '/tests/fixtures/baseline/ecs.js';
const oldRenderer = await import(/* @vite-ignore */ rendererPath),
  oldEcs = await import(/* @vite-ignore */ ecsPath);
const baseline = measure(
  oldRenderer.Canvas2D,
  oldEcs.World,
  oldRenderer.Position2D,
  oldRenderer.Shape2D,
);
const current = measure(Canvas2D, World, Position2D, Shape2D);
Object.assign(window, {
  engineVerification: {
    passed: true,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    baseline,
    current,
  },
});
