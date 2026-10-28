import type { CancellationSignal, Scope, System } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Scene, SceneContext } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import type { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { snapshot, type ReadonlyData } from '../state.js';
import type { AudioControls } from './application-audio.js';
import type { ComponentContext } from './component-types.js';
import {
  defineActions,
  ActionSampler,
  type ActionEntries,
  type ActionDefinitions,
  type ActionSnapshot,
} from './input-actions.js';
import { createGameClock, type GameClock } from './game-clock.js';
const GAME_SCENE = Symbol('game scene');
const CLOCK = '$game-clock';
type NoActions = {};
export type GameSceneAccess = Pick<
  ComponentContext<{}, {}, {}>,
  'assets' | 'useStore' | 'useTheme'
> & { readonly audio?: AudioControls | undefined };
export interface GameSceneContext<P, D, A extends ActionEntries>
  extends SceneContext, GameSceneAccess {
  readonly world: World;
  readonly audio: AudioControls;
  readonly props: ReadonlyData<P>;
  readonly prepared: D;
  readonly clock: GameClock;
  readonly actions: ActionSnapshot<A>;
}
export interface GameSceneOptions<P, D, A extends ActionEntries> {
  readonly id: string;
  readonly actions?: ActionDefinitions<A>;
  readonly prepare?: (signal: CancellationSignal, props: ReadonlyData<P>) => D | PromiseLike<D>;
  readonly setup: (context: GameSceneContext<P, D, A>) => void;
  readonly onPause?: (context: GameSceneContext<P, D, A>) => void;
  readonly onResume?: (context: GameSceneContext<P, D, A>) => void;
}
export interface GameSceneDefinition<P, D, A extends ActionEntries> extends GameSceneOptions<
  P,
  D,
  A
> {
  readonly [GAME_SCENE]: true;
}
export class GameSceneError extends Error {
  readonly module = 'canvas-host';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Game scene ${source}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'GameSceneError';
  }
}
export function defineGameScene<
  P = Record<string, never>,
  D = void,
  A extends ActionEntries = NoActions,
>(options: GameSceneOptions<P, D, A>): GameSceneDefinition<P, D, A> {
  if (
    !options ||
    typeof options.id !== 'string' ||
    !options.id.trim() ||
    typeof options.setup !== 'function' ||
    [options.prepare, options.onPause, options.onResume].some(
      (hook) => hook !== undefined && typeof hook !== 'function',
    )
  )
    throw new GameSceneError(
      options?.id ?? '<scene>',
      'define',
      new Error('An id and valid lifecycle functions are required'),
    );
  if (options.actions) new ActionSampler(options.actions);
  return Object.freeze({ ...options, [GAME_SCENE]: true as const });
}
function synchronous(callback: () => void): void {
  const result: unknown = callback();
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(result).catch(() => {});
    throw new Error('Scene setup/pause/resume hooks must be synchronous');
  }
}

/** Internal adapter. Each transition/restart creates a fresh core Scene and scope. */
export function adaptGameScene<P, D, A extends ActionEntries>(
  definition: GameSceneDefinition<P, D, A>,
  props: P,
  services: (
    context: SceneContext,
  ) => GameSceneAccess & { readActions(): ActionSnapshot<A>; setActive?(active: boolean): void },
): Scene {
  if (definition[GAME_SCENE] !== true)
    throw new GameSceneError('<scene>', 'adapt', new Error('Expected defineGameScene(...)'));
  const fail = (operation: string, error: unknown) =>
    new GameSceneError(definition.id, operation, error);
  let inputs: ReadonlyData<P>;
  try {
    inputs = snapshot(props);
  } catch (error) {
    throw fail('props', error);
  }
  let prepared: D,
    context: GameSceneContext<P, D, A> | undefined,
    used = false;
  const neutral = new ActionSampler(
    definition.actions ?? (defineActions({}) as ActionDefinitions<A>),
  ).read();
  let actions = neutral;
  let setActivity: ((active: boolean) => void) | undefined;
  const hook = (operation: 'onPause' | 'onResume'): void => {
    if (!context || context.signal.aborted) return;
    try {
      actions = neutral;
      context.clock.setActive(operation === 'onResume');
      setActivity?.(operation === 'onResume');
      const callback = definition[operation];
      if (callback) synchronous(() => callback(context!));
    } catch (error) {
      throw fail(operation, error);
    }
  };
  return {
    id: definition.id,
    async prepare(signal) {
      if (used)
        throw fail(
          'prepare',
          new Error('A scene instance cannot be reused; adapt the definition again'),
        );
      used = true;
      try {
        signal.throwIfAborted();
        prepared = definition.prepare ? await definition.prepare(signal, inputs) : (undefined as D);
        signal.throwIfAborted();
      } catch (error) {
        throw fail('prepare', error);
      }
    },
    setup(core) {
      try {
        core.signal.throwIfAborted();
        const access = services(core);
        setActivity = access.setActive;
        const clock = createGameClock({ scope: core.scope, source: definition.id });
        context = Object.freeze({
          ...core,
          world: core.engine.world,
          props: inputs,
          prepared,
          clock,
          get actions() {
            return actions;
          },
          get audio() {
            const audio = access.audio;
            if (!audio) throw fail('audio', new Error('Scene audio is not configured'));
            return audio;
          },
          get assets() {
            return access.assets;
          },
          useStore: access.useStore.bind(access),
          useTheme: access.useTheme.bind(access),
          addSystem(system: System) {
            if (system.id === CLOCK) throw fail('addSystem', new Error('Reserved clock system id'));
            core.addSystem({
              ...system,
              ...((system.phase ?? 'fixed') === 'fixed'
                ? { after: [...(system.after ?? []), CLOCK] }
                : {}),
            });
          },
        });
        core.scope.own(() => {
          actions = neutral;
        });
        core.addSystem({
          id: CLOCK,
          update({ delta }) {
            actions = access.readActions();
            clock.advance(delta);
          },
        });
        synchronous(() => definition.setup(context!));
        core.signal.throwIfAborted();
      } catch (error) {
        throw fail('setup', error);
      }
    },
    onPause: () => hook('onPause'),
    onResume: () => hook('onResume'),
  };
}
