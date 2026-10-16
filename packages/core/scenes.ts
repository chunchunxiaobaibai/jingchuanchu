import { Cancellation, Scope, type CancellationSignal, type Engine, type System } from './index.js';
import type { Entity, Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
export interface SceneContext {
  readonly engine: Engine;
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  create(): Entity;
  addSystem(system: System): void;
  setResource<T>(token: Token<T>, value: NoInfer<T>): void;
  getResource<T>(token: Token<T>): T;
}
export interface Scene {
  id: string;
  prepare?(signal: CancellationSignal): Promise<void>;
  setup(context: SceneContext): void;
  onPause?(): void;
  onResume?(): void;
}
interface ActiveScene {
  scene: Scene;
  scope: Scope;
  cancellation: Cancellation;
  paused: boolean;
}
/** Game scenes own entities/systems/resources; shared Engine services remain owned by the application. */
export class SceneManager {
  private current: ActiveScene | undefined;
  private pending: ActiveScene | undefined;
  private generation = 0;
  private closed = false;
  constructor(readonly engine: Engine) {
    engine.scope.own(() => this.dispose());
  }
  get id(): string | undefined {
    return this.current?.scene.id;
  }
  get paused(): boolean {
    return this.current?.paused ?? false;
  }
  async switchTo(scene: Scene): Promise<void> {
    if (this.closed || this.engine.status === 'disposed')
      throw new Error('Scene manager is disposed');
    this.pending?.cancellation.cancel();
    const candidate: ActiveScene = {
      scene,
      scope: new Scope(),
      cancellation: new Cancellation(),
      paused: false,
    };
    candidate.scope.own(() => candidate.cancellation.cancel());
    this.pending = candidate;
    const prefix = `scene:${++this.generation}:${scene.id}:`;
    const resources = new Map<symbol, unknown>();
    candidate.scope.own(() => resources.clear());
    try {
      const preparation = scene.prepare?.(candidate.cancellation);
      let unsubscribe = () => {};
      try {
        // End the transition even if the loader never observes cancellation.
        await Promise.race([
          preparation,
          new Promise<never>((_, reject) => {
            unsubscribe = candidate.cancellation.subscribe(() => {
              reject(candidate.cancellation.reason);
            });
          }),
        ]);
      } finally {
        unsubscribe();
      }
      candidate.cancellation.throwIfAborted();
      if (this.pending !== candidate || this.closed) throw new Error('Scene transition superseded');
      scene.setup({
        engine: this.engine,
        scope: candidate.scope,
        signal: candidate.cancellation,
        create: () => {
          candidate.cancellation.throwIfAborted();
          const entity = this.engine.world.create();
          candidate.scope.own(() => {
            this.engine.world.destroy(entity);
          });
          return entity;
        },
        addSystem: (system) => {
          candidate.cancellation.throwIfAborted();
          this.engine.addSystem(
            {
              ...system,
              id: prefix + system.id,
              ...(system.before ? { before: system.before.map((id) => prefix + id) } : {}),
              ...(system.after ? { after: system.after.map((id) => prefix + id) } : {}),
              update: (context) => {
                if (this.current === candidate && !candidate.paused) system.update(context);
              },
            },
            candidate.scope,
          );
        },
        setResource: <T>(token: Token<T>, value: NoInfer<T>) => {
          candidate.cancellation.throwIfAborted();
          resources.set(token.key, value);
        },
        getResource: <T>(token: Token<T>): T => {
          candidate.cancellation.throwIfAborted();
          if (!resources.has(token.key)) throw new Error(`Missing scene resource: ${token.name}`);
          return resources.get(token.key) as T;
        },
      });
      // Validate candidate scheduling before retiring the previous scene.
      this.engine.getSystems();
      candidate.cancellation.throwIfAborted();
      const previous = this.current;
      this.current = candidate;
      this.pending = undefined;
      previous?.scope.dispose();
    } catch (error) {
      if (this.pending === candidate) this.pending = undefined;
      if (this.current === candidate) throw error;
      try {
        candidate.scope.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Scene transition failed');
      }
      throw error;
    }
  }
  pause(): void {
    if (this.current && !this.current.paused) {
      this.current.paused = true;
      this.current.scene.onPause?.();
    }
  }
  resume(): void {
    if (this.current?.paused) {
      this.current.paused = false;
      this.current.scene.onResume?.();
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const records = [this.pending, this.current];
    this.pending = undefined;
    this.current = undefined;
    const errors: unknown[] = [];
    for (const record of records)
      try {
        record?.scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Scene cleanup failed');
  }
}
