import { defineComponent, input, output } from './component.js';
import { getComponentMount } from './component-runtime.js';
import { signal, SIGNAL, type ReadSignal } from './reactivity.js';
import { createCanvasRuntime, type CanvasRuntimeRenderer } from './canvas-runtime.js';
import { CanvasHostError } from './canvas-host.js';
import type { GameSceneDefinition } from './game-scene.js';
import type { ActionEntries, AxisAction } from './input-actions.js';

/** Type erasure is limited to the component's heterogeneous scene input. switchTo/forScene remain generic. */
export type GameCanvasScene = GameSceneDefinition<any, any, any>;
export type GameCanvasStatus = 'idle' | 'preparing' | 'running' | 'paused' | 'stopped' | 'disposed';
export type GameCanvasOptions = Omit<
  Parameters<typeof createCanvasRuntime>[0],
  'canvas' | 'owner' | 'scope' | 'onError'
>;
export interface GameSceneControls<A extends ActionEntries> {
  setVirtual<K extends keyof A & string>(
    action: K,
    value: A[K] extends AxisAction ? number : boolean,
    source?: string,
  ): void;
}
export interface GameCanvasHandle {
  readonly status: ReadSignal<GameCanvasStatus>;
  pause(): void;
  resume(): void;
  restart(): Promise<void>;
  switchTo<P, D, A extends ActionEntries>(
    scene: GameSceneDefinition<P, D, A>,
    props: P,
  ): Promise<void>;
  forScene<P, D, A extends ActionEntries>(
    scene: GameSceneDefinition<P, D, A>,
  ): GameSceneControls<A>;
}
export type { CanvasRuntimeRenderer };
export { CanvasHostError };

/** Explicitly register before using <game-canvas>. Give the game-canvas host display:block and an explicit CSS size. */
export const GameCanvas = defineComponent({
  selector: 'game-canvas',
  inputs: {
    scene: input<GameCanvasScene>({ required: true, mode: 'reference' }),
    options: input<GameCanvasOptions>({ required: true, mode: 'reference' }),
    props: input<unknown>({ default: () => ({}) }),
  },
  outputs: {
    ready: output<GameCanvasHandle>(),
    error: output<CanvasHostError>(),
    statusChanged: output<GameCanvasStatus>(),
  },
  $template: '<canvas ref="canvas"></canvas>',
  setup(context) {
    const mount = getComponentMount(context.scope);
    if (!mount) throw new CanvasHostError('mount', new Error('Component owner is unavailable'));
    let runtime: ReturnType<typeof createCanvasRuntime> | undefined;
    let mountedOptions: GameCanvasOptions | undefined, lastScene: unknown, lastProps: unknown;
    let closed = false,
      pageActive = true,
      request = 0,
      pending = false;
    const state = signal<GameCanvasStatus>('idle');
    const status = Object.freeze(
      Object.defineProperty(() => state(), SIGNAL, { value: true }),
    ) as ReadSignal<GameCanvasStatus>;
    const publish = (value: GameCanvasStatus): void => {
      if (state() === value) return;
      state.set(value);
      if (!closed && !mount.owner.disposed) context.emit('statusChanged', value);
    };
    const refresh = (): void => {
      if (closed) {
        publish('disposed');
        return;
      }
      if (pending) {
        publish('preparing');
        return;
      }
      publish(runtime?.controller.engine.status ?? 'idle');
    };
    const report = (error: unknown, operation: string): CanvasHostError => {
      const failure =
        error instanceof CanvasHostError ? error : new CanvasHostError(operation, error);
      if (!closed && !mount.owner.disposed) context.emit('error', failure);
      return failure;
    };
    const requireRuntime = (): NonNullable<typeof runtime> => {
      if (closed || !runtime || runtime.disposed)
        throw new CanvasHostError('handle', new Error('Canvas is not active'));
      return runtime;
    };
    const operate = async (operation: string, work: () => Promise<void>): Promise<void> => {
      requireRuntime();
      const ticket = ++request;
      pending = true;
      refresh();
      try {
        await work();
        if (!closed && ticket === request) {
          pending = false;
          refresh();
          context.emit('ready', game);
        }
      } catch (error) {
        if (!closed && ticket === request) {
          pending = false;
          refresh();
          throw report(error, operation);
        }
        throw error;
      }
    };
    const game: GameCanvasHandle = Object.freeze({
      status,
      pause() {
        requireRuntime().controller.pause();
        refresh();
      },
      resume() {
        requireRuntime().controller.resume();
        refresh();
      },
      restart() {
        const current = requireRuntime();
        return operate('restart', () => current.controller.restart());
      },
      switchTo<P, D, A extends ActionEntries>(scene: GameSceneDefinition<P, D, A>, props: P) {
        const current = requireRuntime();
        return operate('switch', () => current.controller.switchTo(scene, props));
      },
      forScene<P, D, A extends ActionEntries>(
        scene: GameSceneDefinition<P, D, A>,
      ): GameSceneControls<A> {
        const active = (): NonNullable<typeof runtime> => {
          const current = requireRuntime();
          if (current.controller.sceneDefinition !== scene)
            throw new CanvasHostError(
              'virtual',
              new Error('Scene is not committed in this Canvas'),
            );
          return current;
        };
        active();
        return Object.freeze({
          setVirtual<K extends keyof A & string>(
            action: K,
            value: A[K] extends AxisAction ? number : boolean,
            source?: string,
          ) {
            active().actions!.setVirtual(action, value as never, source);
          },
        });
      },
    });
    const update = (): void => {
      if (!runtime || closed) return;
      if (context.inputs.options() !== mountedOptions) {
        report(
          new Error('Canvas options are fixed for this mount; use viewport CSS for resizing'),
          'options',
        );
        return;
      }
      const scene = context.inputs.scene() as GameCanvasScene,
        props = context.inputs.props();
      if (scene === lastScene && props === lastProps) return;
      lastScene = scene;
      lastProps = props;
      void game.switchTo(scene, props).catch(() => {});
    };
    const start = (canvas: HTMLCanvasElement): void => {
      mountedOptions = context.inputs.options() as GameCanvasOptions;
      try {
        runtime = createCanvasRuntime({
          ...mountedOptions,
          canvas,
          owner: mount.owner,
          scope: context.scope,
          onError(error) {
            pending = false;
            refresh();
            report(error, 'frame');
          },
        });
        for (const event of ['started', 'paused', 'resumed', 'stopped', 'disposed'] as const)
          runtime.controller.engine.events.on(event, refresh, context.scope);
        runtime.controller.setActive(pageActive);
        update();
      } catch (error) {
        report(error, 'mount');
        throw error;
      }
    };
    return {
      game,
      start,
      update,
      activate() {
        pageActive = true;
        runtime?.controller.setActive(true);
        refresh();
      },
      deactivate() {
        pageActive = false;
        runtime?.controller.setActive(false);
        refresh();
      },
      destroy() {
        if (closed) return;
        closed = true;
        request++;
        pending = false;
        runtime?.dispose();
        publish('disposed');
      },
    };
  },
  onMount(c) {
    c.exposed.start(c.element<HTMLCanvasElement>('canvas'));
  },
  onInputsChanged(c) {
    c.exposed.update();
  },
  onActivate(c) {
    c.exposed.activate();
  },
  onDeactivate(c) {
    c.exposed.deactivate();
  },
  onDestroy(c) {
    c.exposed.destroy();
  },
});
