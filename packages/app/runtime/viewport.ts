import type { Scope, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { signal, SIGNAL, type ReadSignal } from './reactivity.js';
import { createBrowserViewportDriver } from './browser-viewport.js';

export interface ViewportMeasurement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}
export interface ViewportLayout {
  readonly width: number;
  readonly height: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly left: number;
  readonly top: number;
  readonly pixelRatio: number;
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly active: boolean;
}
export interface GamePoint {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}
export interface ViewportDriver {
  measure(): ViewportMeasurement;
  observe(change: () => void): Cleanup;
  apply(layout: ViewportLayout): void;
  toPoint?(clientX: number, clientY: number): { x: number; y: number };
  bounds?(): {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  dispose?(): void;
}
export interface Viewport {
  readonly layout: ReadSignal<ViewportLayout>;
  readonly disposed: boolean;
  toGamePoint(event: { readonly clientX: number; readonly clientY: number }): GamePoint;
  dispose(): void;
}
export class ViewportError extends Error {
  readonly module = 'viewport-input';
  readonly source = 'viewport';
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Viewport ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`, {
      cause,
    });
    this.name = 'ViewportError';
  }
}
const canvases = new WeakSet<object>();

/** Scope-owned contain viewport, with a host adapter or an injected geometry driver. */
export function createViewport(options: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fit?: 'contain';
  maxPixelRatio?: number;
  scope: Scope;
  driver?: ViewportDriver;
}): Viewport {
  const { canvas, width, height, scope } = options;
  let driver = options.driver!;
  const max = options.maxPixelRatio ?? 2;
  if (
    ![width, height, max].every((value) => Number.isFinite(value) && value > 0) ||
    max > 2 ||
    (options.fit !== undefined && options.fit !== 'contain')
  )
    throw new ViewportError(
      'create',
      new Error('Positive dimensions, contain and maxPixelRatio <= 2 are required'),
    );
  if (canvases.has(canvas))
    throw new ViewportError('create', new Error('Canvas already has a viewport'));
  const initial: ViewportLayout = {
    width,
    height,
    cssWidth: 0,
    cssHeight: 0,
    offsetX: 0,
    offsetY: 0,
    left: 0,
    top: 0,
    pixelRatio: 1,
    bufferWidth: Math.round(width),
    bufferHeight: Math.round(height),
    active: false,
  };
  const state = signal<ViewportLayout>(initial);
  const read = Object.freeze(
    Object.defineProperty(() => state(), SIGNAL, { value: true }),
  ) as ReadSignal<ViewportLayout>;
  let closed = false,
    adopted = false,
    off: Cleanup | undefined,
    applied = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    if (!adopted) return;
    const errors: unknown[] = [];
    for (const cleanup of [() => off?.(), () => driver?.dispose?.()]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    off = undefined;
    canvases.delete(canvas);
    if (state().active) state.set({ ...state(), active: false });
    if (errors.length) throw new ViewportError('dispose', new AggregateError(errors));
  };
  scope.own(dispose);
  if (closed) throw new ViewportError('create', new Error('Scope is disposed'));
  adopted = true;
  canvases.add(canvas);
  const update = (): void => {
    if (closed) return;
    try {
      const geometry = driver.measure();
      if (
        ![geometry.left, geometry.top, geometry.width, geometry.height, geometry.pixelRatio].every(
          Number.isFinite,
        ) ||
        geometry.width < 0 ||
        geometry.height < 0 ||
        geometry.pixelRatio <= 0
      )
        throw new Error('Invalid viewport measurement');
      const active = geometry.width > 0 && geometry.height > 0;
      const scale = active ? Math.min(geometry.width / width, geometry.height / height) : 0;
      const cssWidth = width * scale,
        cssHeight = height * scale;
      const offsetX = (geometry.width - cssWidth) / 2,
        offsetY = (geometry.height - cssHeight) / 2;
      const pixelRatio = Math.min(geometry.pixelRatio, max);
      const next: ViewportLayout = {
        width,
        height,
        cssWidth,
        cssHeight,
        offsetX,
        offsetY,
        left: geometry.left + offsetX,
        top: geometry.top + offsetY,
        pixelRatio,
        bufferWidth: Math.round(width * pixelRatio),
        bufferHeight: Math.round(height * pixelRatio),
        active,
      };
      const previous = state();
      if (
        applied &&
        (Object.keys(next) as (keyof ViewportLayout)[]).every((key) =>
          Object.is(next[key], previous[key]),
        )
      )
        return;
      driver.apply(Object.freeze(next));
      if (closed) return;
      applied = true;
      state.set(next);
    } catch (error) {
      throw error instanceof ViewportError ? error : new ViewportError('update', error);
    }
  };
  try {
    driver = options.driver ?? createBrowserViewportDriver(canvas, width, height, max);
    if (closed) {
      driver.dispose?.();
      throw new Error('Scope disposed during viewport driver creation');
    }
    update();
    if (closed) throw new Error('Scope disposed during viewport initialization');
    off = driver.observe(update);
    if (closed) {
      off();
      off = undefined;
      throw new Error('Scope disposed during viewport observation');
    }
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new ViewportError('create', new AggregateError([error, cleanupError]));
    }
    throw error instanceof ViewportError ? error : new ViewportError('create', error);
  }
  return Object.freeze({
    layout: read,
    get disposed() {
      return closed;
    },
    dispose,
    toGamePoint(event: { readonly clientX: number; readonly clientY: number }): GamePoint {
      if (closed) throw new ViewportError('point', new Error('Viewport is disposed'));
      if (![event.clientX, event.clientY].every(Number.isFinite))
        throw new ViewportError('point', new Error('Point must be finite'));
      update();
      const current = state();
      if (!current.active) return Object.freeze({ x: 0, y: 0, inside: false });
      const bounds = driver.bounds?.() ?? {
        left: current.left,
        top: current.top,
        width: current.cssWidth,
        height: current.cssHeight,
      };
      if (
        ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) ||
        bounds.width < 0 ||
        bounds.height < 0
      )
        throw new ViewportError('point', new Error('Invalid canvas bounds'));
      if (!bounds.width || !bounds.height) return Object.freeze({ x: 0, y: 0, inside: false });
      const point = driver.toPoint?.(event.clientX, event.clientY) ?? {
        x: Math.max(0, Math.min(width, ((event.clientX - bounds.left) * width) / bounds.width)),
        y: Math.max(0, Math.min(height, ((event.clientY - bounds.top) * height) / bounds.height)),
      };
      if (![point.x, point.y].every(Number.isFinite))
        throw new ViewportError('point', new Error('Driver returned an invalid point'));
      return Object.freeze({
        ...point,
        inside:
          event.clientX >= bounds.left &&
          event.clientX < bounds.left + bounds.width &&
          event.clientY >= bounds.top &&
          event.clientY < bounds.top + bounds.height,
      });
    },
  });
}
