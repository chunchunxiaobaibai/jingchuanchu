import { Engine, Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager, type SceneContext } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import { runBrowser, type BrowserDriver } from '@xiaobaibaifqy/jingchuanchu-browser';
import { snapshot } from '../state.js';
import { adaptGameScene, type GameSceneDefinition, type GameSceneAccess } from './game-scene.js';
import type { ActionEntries, ActionSnapshot } from './input-actions.js';

export interface CanvasSceneServices {
  <P, D, A extends ActionEntries>(
    definition: GameSceneDefinition<P, D, A>,
    context: SceneContext,
  ): GameSceneAccess & { readActions(): ActionSnapshot<A>; setActive?(active: boolean): void };
}
export class CanvasHostError extends Error {
  readonly module = 'canvas-host';
  readonly source = 'GameCanvas';
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`GameCanvas ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`, {
      cause,
    });
    this.name = 'CanvasHostError';
  }
}

/** Internal lifecycle controller; DOM, Renderer and application owner wiring are separate. */
export function createCanvasHostController(options: {
  scope: Scope;
  driver: BrowserDriver;
  services: CanvasSceneServices;
  onCommit?: <P, D, A extends ActionEntries>(definition: GameSceneDefinition<P, D, A>) => void;
  input?: { setActive(active: boolean): void; clear(): void };
  clock?: ConstructorParameters<typeof Engine>[0];
  onError(error: CanvasHostError): void;
}) {
  const engine = new Engine(options.clock),
    scenes = new SceneManager(engine),
    lifetime = new Scope();
  let closed = false,
    manual = false,
    pageActive = true,
    hidden = false,
    externalPaused = false,
    externalStopped = false,
    reconciling = false,
    transition = 0;
  let current: { id: string; definition: unknown; restart: () => Promise<void> } | undefined;
  let pending: number | undefined;
  const assertOpen = (operation: string): void => {
    if (closed) throw new CanvasHostError(operation, new Error('Host is disposed'));
  };
  const input = (active: boolean): void => {
    options.input?.setActive(active);
    if (!active) options.input?.clear();
  };
  const reconcile = (): void => {
    if (closed || !current || reconciling || externalStopped) return;
    reconciling = true;
    try {
      if (manual || !pageActive || hidden || externalPaused) {
        try {
          if (engine.status === 'running') engine.pause();
          scenes.pause();
        } finally {
          input(false);
        }
      } else {
        if (engine.status === 'stopped') engine.start();
        else if (engine.status === 'paused') engine.resume();
        scenes.resume();
        input(true);
      }
    } finally {
      reconciling = false;
    }
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    pending = undefined;
    current = undefined;
    transition++;
    const errors: unknown[] = [];
    // Stop input and frames before the scene/Engine retire their resources.
    for (const cleanup of [() => input(false), () => lifetime.dispose(), () => engine.dispose()]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new CanvasHostError('dispose', new AggregateError(errors));
  };
  options.scope.own(dispose);
  assertOpen('create');
  try {
    hidden = options.driver.isHidden();
    engine.events.on('disposed', dispose, lifetime);
    engine.events.on(
      'paused',
      () => {
        if (reconciling) return;
        externalPaused = true;
        reconcile();
      },
      lifetime,
    );
    const began = (): void => {
      if (reconciling) return;
      externalPaused = false;
      externalStopped = false;
      reconcile();
    };
    engine.events.on('started', began, lifetime);
    engine.events.on('resumed', began, lifetime);
    engine.events.on(
      'stopped',
      () => {
        if (!reconciling) externalStopped = true;
        try {
          scenes.pause();
        } finally {
          input(false);
        }
      },
      lifetime,
    );
    runBrowser(engine, (error) => options.onError(new CanvasHostError('frame', error)), {
      scope: lifetime,
      autoStart: false,
      driver: {
        requestFrame: (callback) => options.driver.requestFrame(callback),
        cancelFrame: (id) => options.driver.cancelFrame(id),
        // This controller owns visibility so native automatic resume cannot erase manual intent.
        isHidden: () => false,
        subscribeVisibility: () => () => {},
      },
    });
    const off: Cleanup = options.driver.subscribeVisibility(() => {
      hidden = options.driver.isHidden();
      reconcile();
    });
    lifetime.own(off);
    input(false);
  } catch (error) {
    try {
      dispose();
    } catch (cleanup) {
      throw new CanvasHostError('create', new AggregateError([error, cleanup]));
    }
    throw new CanvasHostError('create', error);
  }
  const switchTo = async <P, D, A extends ActionEntries>(
    definition: GameSceneDefinition<P, D, A>,
    props: P,
  ): Promise<void> => {
    assertOpen('switch');
    let copied: P;
    try {
      copied = snapshot(props) as P;
    } catch (error) {
      throw new CanvasHostError('props', error);
    }
    const scene = adaptGameScene(definition, copied, (context) =>
      options.services(definition, context),
    );
    const ticket = ++transition;
    const instanceId = `host:${ticket}:${definition.id}`;
    pending = ticket;
    try {
      await scenes.switchTo({ ...scene, id: instanceId });
    } catch (error) {
      throw new CanvasHostError('switch', error);
    } finally {
      if (!closed && ticket === transition) {
        pending = undefined;
        // Core may commit successfully and then report the previous scene's cleanup failure.
        if (scenes.id === instanceId) {
          current = { id: definition.id, definition, restart: () => switchTo(definition, copied) };
          externalStopped = false;
          try {
            options.onCommit?.(definition);
            options.input?.clear();
            reconcile();
          } catch (error) {
            try {
              engine.stop();
            } finally {
              input(false);
            }
            throw new CanvasHostError('commit', error);
          }
        }
      }
    }
  };
  return Object.freeze({
    engine,
    get disposed() {
      return closed;
    },
    get sceneId() {
      return current?.id;
    },
    get sceneDefinition() {
      return current?.definition;
    },
    get preparing() {
      return pending !== undefined;
    },
    switchTo,
    restart(): Promise<void> {
      assertOpen('restart');
      if (!current)
        return Promise.reject(new CanvasHostError('restart', new Error('No committed scene')));
      return current.restart();
    },
    pause() {
      assertOpen('pause');
      manual = true;
      reconcile();
    },
    resume() {
      assertOpen('resume');
      manual = false;
      reconcile();
    },
    setActive(active: boolean) {
      assertOpen('activate');
      pageActive = active;
      reconcile();
    },
    dispose,
  });
}
