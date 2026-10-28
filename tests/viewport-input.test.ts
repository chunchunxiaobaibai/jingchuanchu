import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  createViewport,
  ViewportError,
  type ViewportMeasurement,
  type ViewportDriver,
  type ViewportLayout,
} from '../packages/app/runtime/viewport.js';

function fixture(initial: ViewportMeasurement) {
  let geometry = initial,
    notify: (() => void) | undefined,
    applies = 0,
    writes = 0,
    bufferWidth = 0,
    bufferHeight = 0,
    disposed = 0,
    stopped = 0;
  const layouts: ViewportLayout[] = [];
  const driver: ViewportDriver = {
    measure: () => geometry,
    observe(change) {
      notify = change;
      return () => {
        stopped++;
        notify = undefined;
      };
    },
    apply(layout) {
      applies++;
      layouts.push(layout);
      if (bufferWidth !== layout.bufferWidth) {
        bufferWidth = layout.bufferWidth;
        writes++;
      }
      if (bufferHeight !== layout.bufferHeight) {
        bufferHeight = layout.bufferHeight;
        writes++;
      }
    },
    dispose() {
      disposed++;
    },
  };
  const canvas = {} as HTMLCanvasElement,
    scope = new Scope();
  const viewport = createViewport({ canvas, width: 100, height: 50, scope, driver });
  return {
    canvas,
    scope,
    viewport,
    driver,
    layouts,
    set(next: ViewportMeasurement) {
      geometry = next;
      notify?.();
    },
    stats: () => ({ applies, writes, disposed, stopped }),
    move(next: ViewportMeasurement) {
      geometry = next;
    },
  };
}

test('contain preserves logical coordinates across CSS sizes/DPR and identifies letterbox and right/bottom boundaries', () => {
  const f = fixture({ left: 10, top: 20, width: 200, height: 200, pixelRatio: 3 });
  assert.deepEqual(f.viewport.layout(), {
    width: 100,
    height: 50,
    cssWidth: 200,
    cssHeight: 100,
    offsetX: 0,
    offsetY: 50,
    left: 10,
    top: 70,
    pixelRatio: 2,
    bufferWidth: 200,
    bufferHeight: 100,
    active: true,
  });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 110, clientY: 120 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 110, clientY: 30 }), {
    x: 50,
    y: 0,
    inside: false,
  });
  assert.equal(f.viewport.toGamePoint({ clientX: 210, clientY: 120 }).inside, false);
  assert.equal(f.viewport.toGamePoint({ clientX: 110, clientY: 170 }).inside, false);
  assert.deepEqual(f.stats(), { applies: 1, writes: 2, disposed: 0, stopped: 0 });
  f.set({ left: 10, top: 20, width: 100, height: 200, pixelRatio: 2 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 60, clientY: 120 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  assert.equal(f.stats().writes, 2);
  f.set({ left: 10, top: 20, width: 100, height: 200, pixelRatio: 1 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 60, clientY: 120 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  assert.equal(f.stats().writes, 4);
  assert.ok(Object.isFrozen(f.viewport.layout()));
  f.scope.dispose();
  assert.deepEqual(f.stats(), { applies: 3, writes: 4, disposed: 1, stopped: 1 });
  assert.equal(f.viewport.disposed, true);
  assert.throws(() => f.viewport.toGamePoint({ clientX: 0, clientY: 0 }), /disposed/);
  f.viewport.dispose();
  assert.equal(f.stats().disposed, 1);
});

test('point conversion refreshes scrolled geometry, zero-size suspension avoids division, and the injected renderer point mapping is reused', () => {
  const f = fixture({ left: 0, top: 0, width: 200, height: 100, pixelRatio: 1 });
  f.move({ left: 20, top: 40, width: 200, height: 100, pixelRatio: 1 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 120, clientY: 90 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  f.set({ left: 0, top: 0, width: 0, height: 0, pixelRatio: 1 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 0, clientY: 0 }), {
    x: 0,
    y: 0,
    inside: false,
  });
  assert.equal(f.viewport.layout().active, false);
  f.driver.bounds = () => ({ left: 20, top: 40, width: 400, height: 200 });
  f.set({ left: 0, top: 0, width: 200, height: 100, pixelRatio: 1 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 220, clientY: 140 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  f.driver.toPoint = () => ({ x: 7, y: 9 });
  f.set({ left: 0, top: 0, width: 200, height: 100, pixelRatio: 1 });
  assert.deepEqual(f.viewport.toGamePoint({ clientX: 100, clientY: 50 }), {
    x: 7,
    y: 9,
    inside: true,
  });
  f.scope.dispose();
});

test('invalid measurements preserve the last layout, duplicate canvas ownership rejects, and failed initialization releases ownership', () => {
  const f = fixture({ left: 0, top: 0, width: 100, height: 50, pixelRatio: 1 });
  const before = f.viewport.layout();
  assert.throws(
    () => f.set({ left: 0, top: 0, width: NaN, height: 50, pixelRatio: 1 }),
    ViewportError,
  );
  assert.equal(f.viewport.layout(), before);
  assert.throws(
    () =>
      createViewport({
        canvas: f.canvas,
        width: 100,
        height: 50,
        scope: new Scope(),
        driver: f.driver,
      }),
    /already has/,
  );
  f.scope.dispose();
  let released = 0;
  const broken: ViewportDriver = {
    measure: () => ({ left: 0, top: 0, width: -1, height: 1, pixelRatio: 1 }),
    apply() {},
    observe: () => () => {},
    dispose() {
      released++;
    },
  };
  assert.throws(
    () =>
      createViewport({
        canvas: f.canvas,
        width: 100,
        height: 50,
        scope: new Scope(),
        driver: broken,
      }),
    /measurement/,
  );
  assert.equal(released, 1);
  const retry = createViewport({
    canvas: f.canvas,
    width: 100,
    height: 50,
    scope: new Scope(),
    driver: { ...broken, measure: () => ({ left: 0, top: 0, width: 1, height: 1, pixelRatio: 1 }) },
  });
  retry.dispose();
  assert.equal(released, 2);
});
