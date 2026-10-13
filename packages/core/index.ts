import { World, type Token } from '@xiaobai/ecs';

export type Cleanup = () => void;
export class Scope {
  private cleanups: Cleanup[] = [];
  private closed = false;
  own(cleanup: Cleanup): Cleanup {
    if (this.closed) {
      cleanup();
      return cleanup;
    }
    this.cleanups.push(cleanup);
    return cleanup;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse())
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Scope cleanup failed');
  }
}

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();
  on<K extends keyof Events>(
    name: K,
    listener: (payload: Events[K]) => void,
    scope?: Scope,
  ): Cleanup {
    let bucket = this.listeners.get(name);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(name, bucket);
    }
    const wrapped = (payload: unknown): void => listener(payload as Events[K]);
    bucket.add(wrapped);
    const off = (): void => {
      bucket.delete(wrapped);
      if (!bucket.size && this.listeners.get(name) === bucket) this.listeners.delete(name);
    };
    scope?.own(off);
    return off;
  }
  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    const errors: unknown[] = [];
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `Event handler failed: ${String(name)}`);
  }
  clear(): void {
    this.listeners.clear();
  }
}

export interface UpdateContext {
  world: World;
  delta: number;
  tick: number;
  alpha: number;
}
export interface System {
  id: string;
  phase?: 'fixed' | 'render';
  order?: number;
  update(context: UpdateContext): void;
}
export interface EngineModule {
  id: string;
  dependencies?: readonly string[];
  setup(engine: Engine, scope: Scope): void;
}
export interface SystemTiming {
  id: string;
  milliseconds: number;
}
export type EngineStatus = 'stopped' | 'running' | 'paused' | 'disposed';
export interface EngineEvents {
  started: undefined;
  paused: undefined;
  resumed: undefined;
  stopped: undefined;
  disposed: undefined;
}

export class Engine {
  readonly world = new World();
  readonly scope = new Scope();
  readonly events = new EventBus<EngineEvents>();
  readonly timings: SystemTiming[] = [];
  readonly step: number;
  private readonly systems: System[] = [];
  private accumulator = 0;
  private tick = 0;
  private state: EngineStatus = 'stopped';
  private readonly installed = new Set<string>();
  private installing = false;
  constructor(readonly options: { tickRate?: number; maxSteps?: number } = {}) {
    const rate = options.tickRate ?? 30;
    const maxSteps = options.maxSteps ?? 5;
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1)
      throw new Error('Invalid clock options');
    this.step = 1 / rate;
  }
  get status(): EngineStatus {
    return this.state;
  }
  hasModule(id: string): boolean {
    return this.installed.has(id);
  }
  /** Services registered by modules are removed on rollback and engine disposal. */
  provide<T>(token: Token<T>, value: NoInfer<T>, scope: Scope): void {
    this.assertOpen();
    if (this.world.hasResource(token)) throw new Error(`Resource already provided: ${token.name}`);
    this.world.setResource(token, value);
    scope.own(() => {
      if (this.status === 'disposed') return; // The world is cleared after all module cleanups.
      if (this.world.hasResource(token) && Object.is(this.world.getResource(token), value))
        this.world.removeResource(token);
    });
  }
  addSystem(system: System, scope = this.scope): void {
    this.assertOpen();
    if (this.systems.some((item) => item.id === system.id))
      throw new Error(`Duplicate system: ${system.id}`);
    this.systems.push(system);
    this.systems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    scope.own(() => {
      const index = this.systems.indexOf(system);
      if (index >= 0) this.systems.splice(index, 1);
    });
  }
  install(modules: readonly EngineModule[]): void {
    this.assertOpen();
    if (this.state === 'running')
      throw new Error('Stop or pause the engine before installing modules');
    if (this.installing) throw new Error('Module installation is already in progress');
    const byId = new Map(modules.map((module) => [module.id, module]));
    if (byId.size !== modules.length) throw new Error('Duplicate module ID');
    for (const id of byId.keys())
      if (this.installed.has(id)) throw new Error(`Module already installed: ${id}`);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: EngineModule[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (this.installed.has(id)) return;
      if (visiting.has(id)) throw new Error(`Module dependency cycle: ${id}`);
      const module = byId.get(id);
      if (!module) throw new Error(`Missing module: ${id}`);
      visiting.add(id);
      for (const dependency of module.dependencies ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(module);
    };
    for (const module of modules) visit(module.id);
    const scopes: Scope[] = [];
    this.installing = true;
    try {
      for (const module of ordered) {
        const scope = new Scope();
        scopes.push(scope);
        module.setup(this, scope);
        this.assertOpen();
      }
    } catch (error) {
      const errors: unknown[] = [error];
      for (const scope of scopes.reverse())
        try {
          scope.dispose();
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
      throw new AggregateError(errors, 'Module setup failed');
    } finally {
      this.installing = false;
    }
    for (const scope of scopes) this.scope.own(() => scope.dispose());
    for (const module of ordered) this.installed.add(module.id);
  }
  start(): void {
    this.assertOpen();
    if (this.installing) throw new Error('Cannot start during module installation');
    if (this.state === 'running') return;
    this.accumulator = 0;
    this.begin('started');
  }
  pause(): void {
    this.assertOpen();
    if (this.state === 'running') {
      this.state = 'paused';
      this.events.emit('paused', undefined);
    }
  }
  resume(): void {
    this.assertOpen();
    if (this.state === 'paused') {
      this.accumulator = 0;
      this.begin('resumed');
    }
  }
  stop(): void {
    this.assertOpen();
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    this.accumulator = 0;
    this.events.emit('stopped', undefined);
  }
  advance(seconds: number): void {
    this.assertOpen();
    if (this.state !== 'running') return;
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    this.timings.length = 0;
    this.accumulator += Math.min(seconds, this.step * (this.options.maxSteps ?? 5));
    while (this.state === 'running' && this.accumulator + 1e-10 >= this.step) {
      this.tick++;
      this.run('fixed', this.step, 0);
      if (this.state !== 'running') return;
      this.world.flush();
      if (this.state !== 'running') return;
      this.accumulator = Math.max(0, this.accumulator - this.step);
    }
    this.run('render', seconds, this.accumulator / this.step);
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    try {
      this.events.emit('disposed', undefined);
    } finally {
      try {
        this.scope.dispose();
      } finally {
        this.world.dispose();
        this.events.clear();
        this.installed.clear();
      }
    }
  }
  private run(phase: 'fixed' | 'render', delta: number, alpha: number): void {
    for (const system of [...this.systems]) {
      if (this.state !== 'running') break;
      if ((system.phase ?? 'fixed') !== phase) continue;
      const started = performance.now();
      try {
        system.update({ world: this.world, delta, tick: this.tick, alpha });
      } catch (cause) {
        if (this.status !== 'disposed') this.stop();
        throw new Error(`System failed: ${system.id}`, { cause });
      }
      this.timings.push({ id: system.id, milliseconds: performance.now() - started });
    }
  }
  private begin(event: 'started' | 'resumed'): void {
    this.state = 'running';
    try {
      this.events.emit(event, undefined);
    } catch (cause) {
      const errors = [cause];
      if (this.status !== 'disposed') {
        this.state = 'stopped';
        this.accumulator = 0;
        try {
          this.events.emit('stopped', undefined);
        } catch (error) {
          errors.push(error);
        }
      }
      throw new AggregateError(errors, `Engine ${event} failed`);
    }
  }
  private assertOpen(): void {
    if (this.state === 'disposed') throw new Error('Engine is disposed');
  }
}
