import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { createWebGL2Renderer } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/webgl2';
import { defineGameScene, defineActions } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { createCanvasRuntime } from '../packages/app/runtime/canvas-runtime.js';
import { CanvasHostError } from '../packages/app/runtime/canvas-host.js';
import { mockWebGL2 } from './fixtures/webgl2.js';

function fixture() {
  const window = new Window(),
    document = window.document as unknown as Document;
  const container = document.createElement('div'),
    canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  Object.defineProperties(container, { clientWidth: { value: 200 }, clientHeight: { value: 100 } });
  container.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;
  canvas.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: parseFloat(canvas.style.width) || 200,
      height: parseFloat(canvas.style.height) || 100,
    }) as DOMRect;
  const captures = new Set<number>();
  canvas.setPointerCapture = (id) => {
    captures.add(id);
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  let contexts = 0,
    created = 0,
    released = 0,
    draws = 0;
  const context = {
    setTransform() {},
    fillRect() {
      draws++;
    },
  };
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: () => {
      contexts++;
      return context;
    },
  });
  const frames = new Map<number, (time: number) => void>(),
    listeners = new Set<() => void>();
  let nextId = 0;
  const owner = new ComponentOwner(),
    scope = new Scope();
  const options = {
    canvas,
    owner,
    scope,
    width: 100,
    height: 50,
    clock: { tickRate: 10 },
    onError(error: unknown) {
      throw error;
    },
    createRenderer(c: HTMLCanvasElement, width: number, height: number, ratio: number) {
      created++;
      const renderer = new Canvas2D(c, width, height, ratio);
      return {
        canvas: c,
        resize: renderer.resize.bind(renderer),
        toPoint: renderer.toPoint.bind(renderer),
        clear: renderer.clear.bind(renderer),
        drawWorld: renderer.drawWorld.bind(renderer),
        dispose() {
          released++;
        },
      };
    },
    driver: {
      requestFrame(callback: (time: number) => void) {
        const id = ++nextId;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id: number) {
        frames.delete(id);
      },
      isHidden: () => false,
      subscribeVisibility(callback: () => void) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
  };
  const runtime = createCanvasRuntime(options);
  return {
    window,
    document,
    canvas,
    owner,
    scope,
    runtime,
    options,
    frames,
    listeners,
    captures,
    stats: () => ({ contexts, created, released, draws }),
    frame(time: number) {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(time);
    },
    key(code: string) {
      canvas.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          code,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    },
    pointer() {
      canvas.dispatchEvent(
        new window.PointerEvent('pointerdown', {
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: 110,
          clientY: 70,
          bubbles: true,
        }) as unknown as Event,
      );
    },
  };
}

test('Canvas assembly shares one actual Canvas2D with viewport, feeds real DOM key/pointer actions and releases on parent exit', async () => {
  const f = fixture(),
    snapshots: boolean[] = [];
  const actions = defineActions({ fire: { kind: 'button', keys: ['Space'], pointer: 'primary' } });
  const scene = defineGameScene({
    id: 'play',
    actions,
    setup(c) {
      const entity = c.create();
      c.world.set(entity, Position2D, { x: 1, y: 1 });
      c.world.set(entity, Shape2D, { kind: 'rect', width: 2, height: 2, color: 'blue', layer: 0 });
      c.addSystem({
        id: 'rules',
        update() {
          snapshots.push(c.actions.buttons.fire.pressed);
        },
      });
    },
  });
  await f.runtime.controller.switchTo(scene, {});
  assert.deepEqual(f.stats(), { contexts: 1, created: 1, released: 0, draws: 0 });
  assert.equal(f.runtime.viewport.layout().cssWidth, 200);
  f.canvas.focus();
  f.key('Space');
  f.frame(0);
  f.frame(100);
  f.frame(200);
  assert.deepEqual(snapshots, [true, false]);
  assert.equal(f.stats().draws, 6);
  f.pointer();
  assert.equal(f.captures.size, 1);
  f.runtime.controller.pause();
  assert.equal(f.captures.size, 0);
  assert.equal(f.frames.size, 0);
  f.runtime.controller.resume();
  assert.equal(f.frames.size, 1);
  f.owner.dispose();
  f.scope.dispose();
  f.runtime.dispose();
  assert.equal(f.runtime.disposed, true);
  assert.equal(f.runtime.controller.engine.status, 'disposed');
  assert.equal(f.stats().released, 1);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.canvas.width, 0);
  assert.equal(f.canvas.height, 0);
  assert.equal(f.canvas.hasAttribute('tabindex'), false);
});

test('committed scene changes replace action bindings without accumulating captures or frames; failed prepare keeps old bindings', async () => {
  const f = fixture();
  let jump = false;
  const first = defineGameScene({
    id: 'first',
    actions: defineActions({ fire: { kind: 'button', keys: ['Space'], pointer: 'primary' } }),
    setup() {},
  });
  const second = defineGameScene({
    id: 'second',
    actions: defineActions({ jump: { kind: 'button', keys: ['KeyJ'] } }),
    setup(c) {
      c.addSystem({
        id: 'rule',
        update() {
          jump = c.actions.buttons.jump.down;
        },
      });
    },
  });
  try {
    await f.runtime.controller.switchTo(first, {});
    f.pointer();
    assert.equal(f.captures.size, 1);
    const broken = defineGameScene({
      id: 'broken',
      prepare() {
        throw new Error('prepare');
      },
      setup() {},
    });
    await assert.rejects(f.runtime.controller.switchTo(broken, {}));
    assert.equal(f.captures.size, 1);
    await f.runtime.controller.switchTo(second, {});
    assert.equal(f.captures.size, 0);
    f.canvas.focus();
    f.key('Space');
    f.frame(0);
    f.frame(100);
    assert.equal(jump, false);
    f.key('KeyJ');
    f.frame(200);
    assert.equal(jump, true);
    assert.equal(f.frames.size, 1);
    assert.equal(f.stats().contexts, 1);
    assert.throws(() => createCanvasRuntime(f.options), /already has a runtime/);
  } finally {
    f.scope.dispose();
    f.owner.dispose();
  }
});

test('external Engine disposal closes Canvas runtime and permits clean remount with a new owned renderer', async () => {
  const f = fixture();
  await f.runtime.controller.switchTo(defineGameScene({ id: 'empty', setup() {} }), {});
  f.runtime.controller.engine.dispose();
  assert.equal(f.runtime.disposed, true);
  assert.equal(f.stats().released, 1);
  assert.equal(f.frames.size, 0);
  const scope = new Scope();
  const next = createCanvasRuntime({ ...f.options, scope });
  assert.equal(f.stats().created, 2);
  next.dispose();
  scope.dispose();
  f.scope.dispose();
  f.owner.dispose();
  assert.equal(f.stats().released, 2);
});

test('Canvas runtime uses the selected WebGL 2 renderer for viewport, frames and errors', async () => {
  const f = fixture();
  f.runtime.dispose();
  const scope = new Scope();
  const errors: CanvasHostError[] = [];
  const webgl = mockWebGL2(f.canvas);
  const contexts: string[] = [];
  let available = false;
  Object.defineProperty(f.canvas, 'getContext', {
    value(kind: string) {
      contexts.push(kind);
      return available ? webgl.gl : null;
    },
  });
  const options = {
    ...f.options,
    scope,
    createRenderer: createWebGL2Renderer,
    onError: (error: CanvasHostError) => {
      errors.push(error);
    },
  };
  try {
    assert.throws(
      () => createCanvasRuntime(options),
      /GameCanvas create failed.*WebGL 2 is unavailable/,
    );
    available = true;
    const runtime = createCanvasRuntime(options);
    await runtime.controller.switchTo(
      defineGameScene({
        id: 'webgl',
        setup(c) {
          const entity = c.create();
          c.world.set(entity, Position2D, { x: 5, y: 5 });
          c.world.set(entity, Shape2D, {
            kind: 'rect',
            width: 10,
            height: 10,
            color: '#112233',
            layer: 0,
          });
        },
      }),
      {},
    );
    f.frame(0);
    assert.deepEqual(contexts, ['webgl2', 'webgl2']);
    assert.deepEqual(runtime.viewport.toGamePoint({ clientX: 110, clientY: 70 }), {
      x: 50,
      y: 25,
      inside: true,
    });
    assert.equal(webgl.submissions.length, 1);
    webgl.state.lost = true;
    f.canvas.dispatchEvent(
      new f.window.Event('webglcontextlost', { cancelable: true }) as unknown as Event,
    );
    f.frame(100);
    assert.equal(runtime.controller.engine.status, 'running');
    assert.equal(webgl.submissions.length, 1);
    webgl.state.lost = false;
    webgl.state.failLink = true;
    f.canvas.dispatchEvent(new f.window.Event('webglcontextrestored') as unknown as Event);
    f.frame(200);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.operation, 'frame');
    const systemError = errors[0]!.cause;
    assert.ok(systemError instanceof Error);
    assert.match(systemError.message, /canvas-renderer/);
    assert.match(String(systemError.cause), /Cannot restore WebGL 2 renderer/);
    assert.equal(runtime.controller.engine.status, 'stopped');
  } finally {
    scope.dispose();
    f.scope.dispose();
    f.owner.dispose();
  }
  assert.equal(f.canvas.width, 0);
  assert.equal(f.canvas.height, 0);
});
