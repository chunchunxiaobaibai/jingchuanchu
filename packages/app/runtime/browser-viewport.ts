import { Canvas2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ViewportDriver } from './viewport.js';

function restoreStyle(element: HTMLElement, properties: readonly string[]): Cleanup {
  const style = element.style,
    present = element.hasAttribute('style');
  const names = Array.from({ length: style.length }, (_, i) => style.item(i));
  const values = properties.map((name) => ({
    name,
    present: names.includes(name),
    value: style.getPropertyValue(name),
    priority: style.getPropertyPriority(name),
  }));
  return () => {
    for (const value of values) {
      if (value.present) style.setProperty(value.name, value.value, value.priority);
      else style.removeProperty(value.name);
    }
    if (!present && style.length === 0) element.removeAttribute('style');
  };
}

/** Host adapter only; constructing it does not create a browser or animation loop. */
export function createBrowserViewportDriver(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  maxPixelRatio: number,
  sharedRenderer?: Pick<Canvas2D, 'canvas' | 'resize' | 'toPoint'>,
): ViewportDriver {
  const container = canvas.parentElement,
    window = canvas.ownerDocument.defaultView;
  if (!container || !window)
    throw new Error(
      'Viewport requires a canvas container and document window, or an injected driver',
    );
  const restoreCanvas = restoreStyle(canvas, [
    'position',
    'left',
    'top',
    'right',
    'bottom',
    'width',
    'height',
    'display',
    'margin-left',
    'margin-right',
    'margin-top',
    'margin-bottom',
  ]);
  const moveContainer = ['', 'static'].includes(window.getComputedStyle(container).position);
  const restoreContainer = moveContainer ? restoreStyle(container, ['position']) : () => {};
  if (sharedRenderer && sharedRenderer.canvas !== canvas)
    throw new Error('Renderer belongs to another canvas');
  const renderer =
    sharedRenderer ??
    new Canvas2D(canvas, width, height, Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  let closed = false,
    off: Cleanup | undefined;
  return {
    measure() {
      const rect = container.getBoundingClientRect();
      return {
        left: rect.left + container.clientLeft,
        top: rect.top + container.clientTop,
        width: container.clientWidth,
        height: container.clientHeight,
        pixelRatio: window.devicePixelRatio || 1,
      };
    },
    bounds: () => canvas.getBoundingClientRect(),
    toPoint: (x, y) => renderer.toPoint(x, y),
    apply(layout) {
      if (closed) throw new Error('Viewport driver is disposed');
      if (moveContainer) container.style.position = 'relative';
      canvas.style.position = 'absolute';
      canvas.style.display = 'block';
      canvas.style.left = `${layout.offsetX}px`;
      canvas.style.top = `${layout.offsetY}px`;
      canvas.style.right = 'auto';
      canvas.style.bottom = 'auto';
      canvas.style.width = `${layout.cssWidth}px`;
      canvas.style.height = `${layout.cssHeight}px`;
      for (const side of ['left', 'right', 'top', 'bottom'])
        canvas.style.setProperty(`margin-${side}`, '0px');
      renderer.resize(layout.width, layout.height, layout.pixelRatio);
    },
    observe(change) {
      if (closed || off) throw new Error('Viewport driver is disposed or already observed');
      const Resize = (window as unknown as { ResizeObserver?: typeof ResizeObserver })
        .ResizeObserver;
      let observer: ResizeObserver | undefined,
        query: MediaQueryList | undefined,
        stopped = false;
      const resize = () => change();
      const arm = (): void => {
        query?.removeEventListener('change', ratio);
        query =
          typeof window.matchMedia === 'function'
            ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
            : undefined;
        query?.addEventListener('change', ratio);
      };
      const ratio = (): void => {
        arm();
        change();
      };
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        observer?.disconnect();
        window.removeEventListener('resize', resize);
        query?.removeEventListener('change', ratio);
      };
      try {
        observer = Resize ? new Resize(resize) : undefined;
        observer?.observe(container);
        window.addEventListener('resize', resize);
        arm();
      } catch (error) {
        stop();
        throw error;
      }
      off = stop;
      return stop;
    },
    dispose() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      for (const cleanup of [() => off?.(), restoreCanvas, restoreContainer]) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Viewport driver cleanup failed');
    },
  };
}
