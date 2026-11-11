import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import {
  Camera2D,
  Position2D,
  Shape2D,
  Sprite2D,
  Transform2D,
  type Sprite,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { createWebGL2Renderer } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/webgl2';
import { mockWebGL2 } from './fixtures/webgl2.js';

function fixture() {
  const staged: unknown[] = [];
  const staging = {
    width: 0,
    height: 0,
    getContext: (kind: string) => {
      assert.equal(kind, '2d');
      return { drawImage: (source: unknown) => staged.push(source) };
    },
  };
  const canvas = Object.assign(new EventTarget(), {
    width: 300,
    height: 150,
    ownerDocument: { defaultView: null, createElement: () => staging },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  }) as unknown as HTMLCanvasElement;
  const mock = mockWebGL2(canvas);
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value(kind: string) {
      assert.equal(kind, 'webgl2');
      return mock.gl;
    },
  });
  return { canvas, staged, staging, ...mock };
}

function image() {
  return {
    [Symbol.toStringTag]: 'HTMLImageElement',
    naturalWidth: 16,
    naturalHeight: 8,
  } as unknown as HTMLImageElement;
}

function sprite(world: World, source: CanvasImageSource, options: Partial<Sprite> = {}) {
  const entity = world.create();
  world.set(entity, Sprite2D, { image: source, width: 8, height: 4, layer: 1, ...options });
  return entity;
}

function rectangle(world: World, layer = 0) {
  const entity = world.create();
  world.set(entity, Position2D, { x: 2, y: 4 });
  world.set(entity, Shape2D, { kind: 'rect', width: 3, height: 5, color: '#0080ff80', layer });
  return entity;
}

test('WebGL 2 submits transformed atlas quads and only merges adjacent compatible items', () => {
  const f = fixture();
  const renderer = createWebGL2Renderer(f.canvas, 100, 50, 2);
  const world = new World();
  try {
    const a = image(),
      b = image();
    const parent = world.create();
    world.set(parent, Transform2D, { x: 10, y: 20, scaleX: 2, scaleY: 2 });
    const child = sprite(world, a, {
      anchorX: 0.5,
      anchorY: 0.25,
      flipX: true,
      opacity: 0.5,
      frame: { x: 4, y: 2, width: 8, height: 4 },
    });
    world.set(child, Transform2D, { x: 3, y: 4, parent });
    sprite(world, a);
    const other = sprite(world, b);
    sprite(world, a);
    rectangle(world);
    rectangle(world, 2);

    renderer.clear();
    renderer.drawWorld(world, new Camera2D(2, 4, 2));
    assert.deepEqual(f.viewports, [[0, 0, 200, 100]]);
    assert.deepEqual(f.extents, [[100, 50]]);
    assert.deepEqual(renderer.toPoint(110, 70), { x: 50, y: 25 });
    assert.deepEqual(f.uploads, [a, b]);
    assert.deepEqual(
      f.submissions.map(({ count }) => count),
      [6, 12, 6, 6, 6],
    );
    assert.equal(renderer.drawCalls, 5);
    assert.equal(f.submissions[0]!.texture, f.submissions[4]!.texture);
    assert.equal(f.submissions[1]!.texture, f.submissions[3]!.texture);
    assert.notEqual(f.submissions[1]!.texture, f.submissions[2]!.texture);
    assert.deepEqual(f.submissions[0]!.vertices.slice(0, 4), [0, 0, 0, 0]);
    assert.equal(f.submissions[0]!.vertices[7], Math.fround(128 / 255));
    assert.deepEqual(f.submissions[1]!.vertices.slice(0, 12), [
      44,
      44,
      0.25,
      0.25,
      1,
      1,
      1,
      0.5,
      4.5 / 16,
      2.5 / 8,
      11.5 / 16,
      5.5 / 8,
    ]);
    assert.equal(f.submissions[1]!.vertices[12], 0);
    assert.deepEqual(f.submissions[1]!.vertices.slice(13, 17), [12, 44, 0.75, 0.25]);

    world.destroy(other);
    renderer.drawWorld(world);
    assert.equal(renderer.drawCalls, 3);
    assert.equal(renderer.textureUploadMs, 0);
    assert.deepEqual(f.deletedTextures, [f.submissions[2]!.texture]);
  } finally {
    renderer.dispose();
    world.dispose();
  }
});

test('WebGL 2 adapts Canvas2D circle centers and diameters in the same batch as rectangles', () => {
  const f = fixture();
  const renderer = createWebGL2Renderer(f.canvas);
  const world = new World();
  try {
    const circle = rectangle(world);
    world.set(circle, Shape2D, {
      kind: 'circle',
      width: 8,
      height: 20,
      color: '#ffffff',
      layer: 0,
    });
    rectangle(world);
    const transformed = world.create();
    world.set(transformed, Shape2D, world.require(circle, Shape2D));
    world.set(transformed, Transform2D, { x: 10, y: 12, scaleX: 2, scaleY: 0.5 });

    renderer.drawWorld(world);
    assert.equal(renderer.drawCalls, 1);
    assert.equal(f.submissions[0]!.count, 18);
    const vertices = f.submissions[0]!.vertices;
    const corner = (index: number) => vertices.slice(index * 13, index * 13 + 4);
    assert.deepEqual(corner(0), [-2, 0, 0, 0]);
    assert.deepEqual(corner(5), [6, 8, 1, 1]);
    assert.equal(vertices[12], 1);
    assert.equal(vertices[6 * 13 + 12], 0);
    assert.deepEqual(corner(12), [2, 10, 0, 0]);
    assert.deepEqual(corner(17), [18, 14, 1, 1]);
    assert.equal(vertices[12 * 13 + 12], 1);
  } finally {
    renderer.dispose();
    world.dispose();
  }
});

test('WebGL 2 flushes a full vertex buffer and preserves remaining same-texture items', () => {
  const f = fixture(),
    renderer = createWebGL2Renderer(f.canvas),
    world = new World();
  try {
    const source = image();
    for (let i = 0; i < 1025; i++) sprite(world, source);
    renderer.drawWorld(world);
    assert.deepEqual(
      f.submissions.map(({ count }) => count),
      [1024 * 6, 6],
    );
    assert.equal(f.uploads.length, 1);
  } finally {
    renderer.dispose();
    world.dispose();
  }
});

test('WebGL 2 restores current dimensions and uploads current world textures after loss', () => {
  const f = fixture(),
    renderer = createWebGL2Renderer(f.canvas, 100, 50),
    world = new World();
  try {
    const bitmap: ImageBitmap = {
      [Symbol.toStringTag]: 'ImageBitmap',
      width: 16,
      height: 8,
      close() {},
    } as ImageBitmap;
    sprite(world, bitmap);
    renderer.drawWorld(world);
    assert.deepEqual(f.staged, [bitmap]);
    assert.equal(f.uploads[0], f.staging);
    assert.equal(f.staging.width, 0);
    f.state.lost = true;
    const loss = new Event('webglcontextlost', { cancelable: true });
    f.canvas.dispatchEvent(loss);
    assert.equal(loss.defaultPrevented, true);
    renderer.resize(80, 40, 1.5);
    renderer.clear();
    renderer.drawWorld(world);
    assert.equal(renderer.drawCalls, 0);
    assert.equal(f.counts.clears, 0);
    assert.equal(f.viewports.length, 1);
    f.state.lost = false;
    f.canvas.dispatchEvent(new Event('webglcontextrestored'));
    renderer.clear();
    renderer.drawWorld(world);
    assert.equal(f.counts.programs, 2);
    assert.deepEqual(f.viewports.at(-1), [0, 0, 120, 60]);
    assert.deepEqual(f.extents.at(-1), [80, 40]);
    assert.deepEqual(f.staged, [bitmap, bitmap]);
    assert.notEqual(f.submissions[0]!.texture, f.submissions[1]!.texture);
  } finally {
    renderer.dispose();
    world.dispose();
  }
  assert.equal(f.deletedTextures.length, 2);
  assert.equal(f.counts.deletedBuffers, 1);
  assert.equal(f.counts.deletedArrays, 1);
  assert.equal(f.counts.deletedPrograms, 1);
  const late = new Event('webglcontextlost', { cancelable: true });
  f.canvas.dispatchEvent(late);
  f.canvas.dispatchEvent(new Event('webglcontextrestored'));
  renderer.clear();
  renderer.dispose();
  assert.equal(late.defaultPrevented, false);
  assert.equal(f.counts.programs, 2);
  assert.equal(f.counts.clears, 1);
});

test('WebGL 2 reports invalid content, upload errors and partial initialization failures', () => {
  const f = fixture();
  f.state.failLink = true;
  assert.throws(() => createWebGL2Renderer(f.canvas), /Cannot link WebGL 2 program/);
  assert.equal(f.counts.deletedPrograms, 1);
  f.state.failLink = false;
  const renderer = createWebGL2Renderer(f.canvas);
  const world = new World();
  try {
    assert.throws(() => renderer.clear('#fff'), /expected #RRGGBB/);
    const entity = rectangle(world);
    world.require(entity, Shape2D).kind = 'circle';
    world.require(entity, Shape2D).width = -2;
    assert.throws(
      () => renderer.drawWorld(world),
      /entity 0:\d+.*Circle radius must be nonnegative/,
    );
    world.destroy(entity);
    const invalid = sprite(world, f.canvas);
    assert.throws(
      () => renderer.drawWorld(world),
      /Expected a static HTMLImageElement or ImageBitmap/,
    );
    world.destroy(invalid);
    const atlas = sprite(world, image(), { frame: { x: 9, y: 0, width: 8, height: 4 } });
    f.state.uploadError = 0x501;
    assert.throws(
      () => renderer.drawWorld(world),
      /Cannot upload sprite texture: WebGL error 0x501/,
    );
    assert.equal(f.deletedTextures.length, 1);
    f.state.uploadError = 0;
    assert.throws(() => renderer.drawWorld(world), /Sprite frame is outside its texture/);
    delete world.require(atlas, Sprite2D).frame;
    renderer.drawWorld(world);
    assert.equal(renderer.drawCalls, 1);
  } finally {
    renderer.dispose();
    world.dispose();
  }
});
