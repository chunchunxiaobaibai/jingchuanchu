import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import {
  Camera2D,
  Canvas2D,
  Position2D,
  Shape2D,
  Sprite2D,
  Transform2D,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { createWebGL2Renderer } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/webgl2';

const width = 960;
const height = 600;
const warmupFrames = 30;
const measuredFrames = 120;

async function createAtlas() {
  const source = document.createElement('canvas');
  source.width = 48;
  source.height = 24;
  const context = source.getContext('2d')!;
  context.fillStyle = '#e69d50';
  context.fillRect(2, 2, 20, 20);
  context.fillStyle = '#72adf8';
  context.fillRect(26, 2, 20, 20);
  context.fillStyle = '#25374f';
  context.fillRect(5, 4, 6, 9);
  context.fillRect(29, 4, 6, 9);
  const image = new Image();
  image.src = source.toDataURL();
  await image.decode();
  return image;
}

function populate(world: World, image: HTMLImageElement, size: number) {
  const parent = world.create();
  world.set(parent, Transform2D, { x: 9, y: 5, scaleX: 0.98, scaleY: 0.98 });
  const backdrop = world.create();
  world.set(backdrop, Position2D, { x: 40, y: 40 });
  world.set(backdrop, Shape2D, {
    kind: 'rect',
    width: 870,
    height: 510,
    color: '#283958',
    layer: 0,
  });
  for (let i = 0; i < size; i++) {
    const entity = world.create();
    world.set(entity, Transform2D, {
      x: 34 + ((i * 137) % 880),
      y: 34 + ((i * 91) % 520),
      rotation: i % 3 === 0 ? 0.2 : 0,
      parent,
    });
    world.set(entity, Sprite2D, {
      image,
      width: 26,
      height: 26,
      frame: { x: (i % 2) * 24, y: 0, width: 24, height: 24 },
      opacity: i % 3 === 0 ? 0.55 : 1,
      anchorX: 0.5,
      anchorY: 0.5,
      flipX: i % 4 === 0,
      layer: i % 2 === 0 ? 1 : 3,
    });
  }
  const overlay = world.create();
  world.set(overlay, Position2D, { x: 420, y: 90 });
  world.set(overlay, Shape2D, {
    kind: 'rect',
    width: 125,
    height: 410,
    color: '#58a87280',
    layer: 2,
  });
  const player = world.create();
  world.set(player, Position2D, { x: 480, y: 280 });
  world.set(player, Shape2D, { kind: 'circle', width: 44, height: 44, color: '#70d4b0', layer: 4 });
}

const surface = document.querySelector('#surface')!;
const result = document.querySelector('#result')!;
const form = document.querySelector('form')!;
const submit = form.querySelector('button')!;
let disposeRenderer: (() => void) | undefined;

async function run(backend: FormDataEntryValue | null, workload: FormDataEntryValue | null) {
  disposeRenderer?.();
  disposeRenderer = undefined;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width: ${width}px; max-width: 100%; aspect-ratio: ${width} / ${height};`;
  surface.replaceChildren(canvas);
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  const webgl =
    backend === 'webgl2' ? createWebGL2Renderer(canvas, width, height, pixelRatio) : undefined;
  const renderer = webgl ?? new Canvas2D(canvas, width, height, pixelRatio);
  disposeRenderer = () => webgl?.dispose();

  const size = workload === 'dense' ? 10000 : 160;
  const world = new World();
  const camera = new Camera2D(4, 2);
  const intervalsMs: number[] = [];
  const submittedBatches: number[] = [];
  let firstTextureUploadMs: number | undefined;
  let previous: number | undefined;
  let index = 0;
  try {
    populate(world, await createAtlas(), size);
    await new Promise<void>((resolve, reject) => {
      const draw = (now: number) => {
        try {
          renderer.clear('#182031');
          renderer.drawWorld(world, camera);
          if (webgl && index === 0) firstTextureUploadMs = webgl.textureUploadMs;
          if (index >= warmupFrames && previous !== undefined) {
            intervalsMs.push(now - previous);
            if (webgl) submittedBatches.push(webgl.drawCalls);
          }
          previous = now;
          index++;
          if (index < warmupFrames + measuredFrames) requestAnimationFrame(draw);
          else resolve();
        } catch (error) {
          reject(error);
        }
      };
      requestAnimationFrame(draw);
    });
  } finally {
    world.dispose();
  }
  const sorted = intervalsMs.slice().sort((a, b) => a - b);
  return {
    backend,
    workload,
    size,
    browser: navigator.userAgent,
    logicalSize: { width, height },
    bufferSize: { width: canvas.width, height: canvas.height },
    pixelRatio,
    warmupFrames,
    measuredFrames,
    p95FrameIntervalMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    intervalsMs,
    ...(webgl ? { firstTextureUploadCpuMs: firstTextureUploadMs, submittedBatches } : {}),
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  result.textContent = '采样中';
  const options = new FormData(form);
  try {
    result.textContent = JSON.stringify(
      await run(options.get('backend'), options.get('workload')),
      null,
      2,
    );
  } catch (error) {
    disposeRenderer?.();
    disposeRenderer = undefined;
    result.textContent = String(error);
  } finally {
    submit.disabled = false;
  }
});
