import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { createViewport } from '@xiaobaibaifqy/jingchuanchu-app/application';

function fixture(observe = true) {
  const window = new Window(),
    document = window.document as unknown as Document;
  const container = document.createElement('div'),
    canvas = document.createElement('canvas');
  document.body.append(container);
  container.append(canvas);
  let width = 200,
    height = 200,
    dpr = 1,
    writes = 0,
    bufferWidth = 300,
    bufferHeight = 150,
    transforms = 0,
    disconnected = 0;
  let changed: (() => void) | undefined;
  const queries: { listeners: Set<() => void>; media: string }[] = [];
  Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, configurable: true });
  Object.defineProperties(container, {
    clientWidth: { get: () => width },
    clientHeight: { get: () => height },
    clientLeft: { value: 2 },
    clientTop: { value: 4 },
  });
  container.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: width + 4, height: height + 8 }) as DOMRect;
  Object.defineProperties(canvas, {
    width: {
      get: () => bufferWidth,
      set(value: number) {
        writes++;
        bufferWidth = value;
      },
    },
    height: {
      get: () => bufferHeight,
      set(value: number) {
        writes++;
        bufferHeight = value;
      },
    },
    getContext: {
      configurable: true,
      value: () => ({
        setTransform() {
          transforms++;
        },
      }),
    },
  });
  canvas.getBoundingClientRect = () => {
    const left = 12 + (parseFloat(canvas.style.left) || 0),
      top = 24 + (parseFloat(canvas.style.top) || 0);
    const w = parseFloat(canvas.style.width) || 0,
      h = parseFloat(canvas.style.height) || 0;
    return { left, top, width: w, height: h, right: left + w, bottom: top + h } as DOMRect;
  };
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: observe
      ? class {
          constructor(callback: () => void) {
            changed = callback;
          }
          observe() {}
          disconnect() {
            disconnected++;
          }
        }
      : undefined,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: observe
      ? (media: string) => {
          const entry = { listeners: new Set<() => void>(), media };
          queries.push(entry);
          return {
            addEventListener(_type: string, callback: () => void) {
              entry.listeners.add(callback);
            },
            removeEventListener(_type: string, callback: () => void) {
              entry.listeners.delete(callback);
            },
          };
        }
      : undefined,
  });
  return {
    window,
    container,
    canvas,
    queries,
    resize(w: number, h: number) {
      width = w;
      height = h;
      if (observe) changed?.();
      else window.dispatchEvent(new window.Event('resize'));
    },
    ratio(value: number) {
      dpr = value;
      for (const callback of [...queries.at(-1)!.listeners]) callback();
    },
    stats: () => ({ writes, transforms, disconnected }),
  };
}

test('default viewport uses host observers and real Canvas2D resize/toPoint logic without a browser process or global window', () => {
  const f = fixture(),
    scope = new Scope();
  f.canvas.style.setProperty('left', '3px', 'important');
  f.canvas.style.opacity = '0.3';
  const viewport = createViewport({ canvas: f.canvas, width: 100, height: 50, scope });
  assert.equal(f.canvas.style.position, 'absolute');
  assert.equal(f.container.style.position, 'relative');
  assert.equal(f.canvas.style.width, '200px');
  assert.equal(f.canvas.style.top, '50px');
  assert.deepEqual(viewport.toGamePoint({ clientX: 112, clientY: 124 }), {
    x: 50,
    y: 25,
    inside: true,
  });
  assert.equal(viewport.toGamePoint({ clientX: 112, clientY: 30 }).inside, false);
  assert.equal(f.stats().writes, 2);
  f.resize(100, 200);
  assert.equal(f.stats().writes, 2);
  f.ratio(3);
  assert.equal(viewport.layout().pixelRatio, 2);
  assert.equal(f.stats().writes, 4);
  assert.equal(f.queries[0]!.listeners.size, 0);
  assert.equal(f.queries[1]!.listeners.size, 1);
  f.window.dispatchEvent(new f.window.Event('resize'));
  assert.equal(f.stats().writes, 4);
  f.canvas.style.opacity = '0.7';
  scope.dispose();
  assert.equal(f.stats().disconnected, 1);
  assert.ok(f.queries.every((query) => query.listeners.size === 0));
  assert.equal(f.canvas.style.left, '3px');
  assert.equal(f.canvas.style.getPropertyPriority('left'), 'important');
  assert.equal(f.canvas.style.opacity, '0.7');
  assert.equal(f.container.hasAttribute('style'), false);
  f.resize(500, 500);
  assert.equal(f.stats().writes, 4);
});

test('resize fallback suspends zero-size containers and failed context initialization releases the Canvas for retry', () => {
  const f = fixture(false),
    scope = new Scope();
  const viewport = createViewport({
    canvas: f.canvas,
    width: 100,
    height: 50,
    maxPixelRatio: 1,
    scope,
  });
  f.resize(0, 0);
  assert.equal(viewport.layout().active, false);
  assert.deepEqual(viewport.toGamePoint({ clientX: 0, clientY: 0 }), { x: 0, y: 0, inside: false });
  f.resize(100, 50);
  assert.equal(viewport.layout().active, true);
  scope.dispose();
  const other = fixture();
  Object.defineProperty(other.canvas, 'getContext', { configurable: true, value: () => null });
  assert.throws(
    () => createViewport({ canvas: other.canvas, width: 100, height: 50, scope: new Scope() }),
    /Canvas 2D is unavailable/,
  );
  assert.equal(other.container.hasAttribute('style'), false);
  Object.defineProperty(other.canvas, 'getContext', { value: () => ({ setTransform() {} }) });
  const retry = createViewport({
    canvas: other.canvas,
    width: 100,
    height: 50,
    scope: new Scope(),
  });
  retry.dispose();
});
