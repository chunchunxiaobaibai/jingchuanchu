import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { SceneContext } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import type { GameSceneDefinition } from './game-scene.js';
import type { BrowserDriver } from '@xiaobaibaifqy/jingchuanchu-browser';
import { Canvas2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { createViewport } from './viewport.js';
import { createBrowserViewportDriver } from './browser-viewport.js';
import { createActions, type Actions } from './browser-actions.js';
import { defineActions, type ActionEntries, type ActionSnapshot } from './input-actions.js';
import { createCanvasHostController, CanvasHostError } from './canvas-host.js';
import { createGameSceneAccess } from './game-scene-access.js';
import type { ComponentOwner } from './component-owner.js';

export type CanvasRuntimeRenderer = Pick<
  Canvas2D,
  'canvas' | 'resize' | 'toPoint' | 'clear' | 'drawWorld'
> & { dispose?(): void };
const canvases = new WeakSet<HTMLCanvasElement>();
function frameDriver(canvas: HTMLCanvasElement): BrowserDriver {
  const document = canvas.ownerDocument,
    view = document.defaultView;
  if (!view) throw new Error('Canvas requires a document window');
  return {
    requestFrame: (callback) => view.requestAnimationFrame(callback),
    cancelFrame: (id) => view.cancelAnimationFrame(id),
    isHidden: () => document.visibilityState === 'hidden',
    subscribeVisibility(callback) {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}

/** Internal Canvas assembly. Opening/mounting any actual browser is never part of construction. */
export function createCanvasRuntime(options: {
  canvas: HTMLCanvasElement;
  owner: ComponentOwner;
  scope: Scope;
  width: number;
  height: number;
  maxPixelRatio?: number;
  background?: string;
  clock?: Parameters<typeof createCanvasHostController>[0]['clock'];
  driver?: BrowserDriver;
  createRenderer?: (
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    pixelRatio: number,
  ) => CanvasRuntimeRenderer;
  onError(error: CanvasHostError): void;
}) {
  const { canvas, width, height, owner, scope } = options,
    max = options.maxPixelRatio ?? 2;
  owner.assertOpen();
  if (canvases.has(canvas))
    throw new CanvasHostError('create', new Error('Canvas already has a runtime'));
  if (![width, height, max].every((value) => Number.isFinite(value) && value > 0) || max > 2)
    throw new CanvasHostError(
      'create',
      new Error('Positive dimensions and pixel ratio <= 2 are required'),
    );
  const life = new Scope();
  let closed = false,
    adopted = false;
  let offOwner: (() => void) | undefined;
  let bindingScope: Scope | undefined, actions: Actions<ActionEntries> | undefined;
  let inputActive = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    offOwner?.();
    offOwner = undefined;
    try {
      life.dispose();
    } finally {
      if (adopted) canvases.delete(canvas);
    }
  };
  scope.own(dispose);
  if (closed) throw new CanvasHostError('create', new Error('Scope is disposed'));
  canvases.add(canvas);
  adopted = true;
  try {
    offOwner = owner.cancellation.subscribe(dispose);
    const ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, max);
    const renderer: CanvasRuntimeRenderer = (
      options.createRenderer ?? ((...args) => new Canvas2D(...args))
    )(canvas, width, height, ratio);
    life.own(() => {
      try {
        renderer.dispose?.();
      } finally {
        if (canvas.width !== 0) canvas.width = 0;
        if (canvas.height !== 0) canvas.height = 0;
      }
    });
    if (renderer.canvas !== canvas) throw new Error('Renderer belongs to another canvas');
    const viewport = createViewport({
      canvas,
      width,
      height,
      maxPixelRatio: max,
      scope: life,
      driver: createBrowserViewportDriver(canvas, width, height, max, renderer),
    });
    life.own(() => {
      bindingScope?.dispose();
      actions = undefined;
      bindingScope = undefined;
    });
    const controller = createCanvasHostController({
      scope: life,
      driver: options.driver ?? frameDriver(canvas),
      ...(options.clock ? { clock: options.clock } : {}),
      onError: options.onError,
      input: {
        setActive(active) {
          inputActive = active;
          actions?.setActive(active);
        },
        clear() {
          actions?.clear();
        },
      },
      onCommit(definition) {
        bindingScope?.dispose();
        actions = undefined;
        bindingScope = new Scope();
        actions = createActions({
          canvas,
          viewport,
          scope: bindingScope,
          definition: definition.actions ?? defineActions({}),
        });
        actions.setActive(inputActive);
      },
      services<P, D, A extends ActionEntries>(
        definition: GameSceneDefinition<P, D, A>,
        core: SceneContext,
      ) {
        const access = createGameSceneAccess(owner, core.scope);
        return {
          get audio() {
            return access.audio;
          },
          get assets() {
            return access.assets;
          },
          setActive: access.setActive,
          useStore: access.useStore,
          useTheme: access.useTheme,
          readActions() {
            if (!actions)
              throw new CanvasHostError('input', new Error('No committed action binding'));
            return actions.read() as ActionSnapshot<A>;
          },
        };
      },
    });
    controller.engine.events.on('disposed', dispose, life);
    controller.engine.addSystem({
      id: 'canvas-renderer',
      phase: 'render',
      order: 1000,
      update({ world }) {
        if (!viewport.layout().active) return;
        renderer.clear(options.background ?? '#ffffff');
        renderer.drawWorld(world);
      },
    });
    return Object.freeze({
      controller,
      viewport,
      renderer,
      get actions() {
        return actions;
      },
      get disposed() {
        return closed;
      },
      dispose,
    });
  } catch (error) {
    try {
      dispose();
    } catch (cleanup) {
      throw new CanvasHostError('create', new AggregateError([error, cleanup]));
    }
    throw new CanvasHostError('create', error);
  }
}
