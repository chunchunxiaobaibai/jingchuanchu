import type { CancellationSignal, Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { ComponentOwner, type OwnerResolver } from './component-owner.js';
import {
  StoreTasks,
  type StoreTaskContext,
  type StoreTaskResult,
  type StoreTaskOptions,
} from './store-tasks.js';
import { batch } from './scheduler.js';
import { snapshot } from '../state.js';
import { SIGNAL, runUntracked, type ReadSignal, type WritableSignal } from './reactivity.js';

const STORE = Symbol('application store definition');
type StateMap = Readonly<Record<string, WritableSignal<unknown>>>;
type GetterMap = Readonly<Record<string, ReadSignal<unknown>>>;
type ActionMap = Readonly<Record<string, (...args: never[]) => unknown>>;
type Readers<S> = {
  readonly [K in keyof S]: S[K] extends ReadSignal<infer V> ? ReadSignal<V> : never;
};
export interface StoreContext {
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  own(cleanup: Cleanup): Cleanup;
  onReset(cleanup: Cleanup): Cleanup;
  runTask<T>(
    run: (context: StoreTaskContext) => T | PromiseLike<T>,
    options?: StoreTaskOptions,
  ): Promise<StoreTaskResult<T>>;
  useStore<T>(definition: Token<T>): T;
  useService<T>(definition: Token<T>): T;
}
export interface StoreInstance<S extends StateMap, G extends GetterMap, A extends ActionMap> {
  readonly state: Readers<S>;
  readonly getters: Readers<G>;
  readonly actions: Readonly<A>;
  readonly userScoped: boolean;
  reset(): void;
  dispose(): void;
}
export interface StoreDefinition<
  S extends StateMap,
  G extends GetterMap,
  A extends ActionMap,
> extends Token<StoreInstance<S, G, A>> {
  readonly [STORE]: true;
  readonly userScoped: boolean;
  readonly setup: (context: StoreContext) => { state: S; getters: G; actions: A };
}
type RuntimeDefinition = StoreDefinition<StateMap, GetterMap, ActionMap>;
type RuntimeInstance = StoreInstance<StateMap, GetterMap, ActionMap>;
export class StoreError extends Error {
  readonly module = 'state-store';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Store ${source}: ${operation} failed${cause instanceof Error ? `: ${cause.message}` : ''}`,
      { cause },
    );
    this.name = 'StoreError';
  }
}
export function defineStore<
  const S extends StateMap,
  const G extends GetterMap,
  const A extends ActionMap,
>(options: {
  readonly name: string;
  readonly userScoped?: boolean;
  readonly setup: (context: StoreContext) => { state: S; getters: G; actions: A };
}): StoreDefinition<S, G, A> {
  if (typeof options.name !== 'string' || !options.name.trim())
    throw new Error('Store name is required');
  return Object.freeze({
    ...options,
    userScoped: options.userScoped ?? false,
    key: Symbol(options.name),
    [STORE]: true as const,
  });
}
function isDefinition(token: Token<unknown>): token is RuntimeDefinition {
  return STORE in token && token[STORE] === true;
}
function readers(
  fields: Readonly<Record<string, ReadSignal<unknown>>>,
  state: boolean,
): Record<string, ReadSignal<unknown>> {
  const result: Record<string, ReadSignal<unknown>> = Object.create(null);
  for (const [name, read] of Object.entries(fields)) {
    if (
      typeof read !== 'function' ||
      !(SIGNAL in read) ||
      (state && typeof (read as WritableSignal<unknown>).set !== 'function')
    )
      throw new Error(`Invalid ${state ? 'state' : 'getter'} signal: ${name}`);
    const wrapped = (() => read()) as ReadSignal<unknown>;
    Object.defineProperty(wrapped, SIGNAL, { value: true });
    result[name] = Object.freeze(wrapped);
  }
  return Object.freeze(result);
}

/** Internal registry consumed by application/page owners; never a module-level store cache. */
export class StoreRegistry implements OwnerResolver {
  private readonly definitions: Set<Token<unknown>>;
  private readonly owners = new WeakMap<
    ComponentOwner,
    {
      instances: Map<Token<unknown>, { owner: ComponentOwner; value: RuntimeInstance }>;
      creating: RuntimeDefinition[];
    }
  >();
  constructor(
    definitions: readonly Token<unknown>[] = [],
    private readonly options: { automatic?: boolean } = {},
  ) {
    for (const definition of definitions)
      if (!isDefinition(definition)) throw new Error(`Invalid store provider: ${definition.name}`);
    this.definitions = new Set(definitions);
  }
  has(token: Token<unknown>): boolean {
    return isDefinition(token) && (this.options.automatic === true || this.definitions.has(token));
  }
  resolve<T>(token: Token<T>, providerOwner: ComponentOwner): T {
    providerOwner.assertOpen();
    if (!isDefinition(token) || !this.has(token))
      throw new StoreError(token.name, 'resolve', new Error('Store is not provided'));
    let registry = this.owners.get(providerOwner);
    if (!registry) {
      registry = { instances: new Map(), creating: [] };
      this.owners.set(providerOwner, registry);
      const instances = registry.instances;
      providerOwner.scope.own(() => instances.clear());
    }
    const cached = registry.instances.get(token);
    if (cached) {
      if (cached.owner.disposed)
        throw new StoreError(token.name, 'resolve', new Error('Store is disposed'));
      return cached.value as T;
    }
    if (registry.creating.includes(token))
      throw new StoreError(
        token.name,
        'setup',
        new Error(
          `Circular store dependency: ${[...registry.creating, token].map((d) => d.name).join(' -> ')}`,
        ),
      );
    const owner = new ComponentOwner(providerOwner, {}, 'manual');
    const tasks = new StoreTasks(
      owner,
      (operation, cause) => new StoreError(token.name, operation, cause),
    );
    const resets = new Set<Cleanup>();
    owner.scope.own(() => resets.clear());
    registry.creating.push(token);
    try {
      const context: StoreContext = {
        scope: owner.scope,
        signal: owner.cancellation,
        own: (cleanup) => {
          owner.assertOpen();
          return owner.scope.own(cleanup);
        },
        onReset: (cleanup) => {
          owner.assertOpen();
          resets.add(cleanup);
          return () => {
            resets.delete(cleanup);
          };
        },
        runTask: (run, options) => tasks.run(run, options),
        useStore: (definition) => owner.resolve('stores', definition),
        useService: (definition) => owner.resolve('services', definition),
      };
      const value = runUntracked(() => token.setup(context));
      owner.assertOpen();
      providerOwner.assertOpen();
      if (!value || typeof value !== 'object')
        throw new Error('Store setup must return state, getters and actions');
      for (const key of ['state', 'getters', 'actions'] as const)
        if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))
          throw new Error(`Store ${key} must be a field object`);
      const state = readers(value.state, true),
        getters = readers(value.getters, false),
        actions: Record<string, (...args: unknown[]) => unknown> = Object.create(null);
      for (const [name, action] of Object.entries(value.actions)) {
        if (typeof action !== 'function') throw new Error(`Invalid store action: ${name}`);
        actions[name] = (...args: unknown[]): unknown => {
          try {
            owner.assertOpen();
            const result = Reflect.apply(action, value.actions, args);
            if (result && typeof (result as PromiseLike<unknown>).then === 'function')
              return Promise.resolve(result).catch((error) => {
                throw new StoreError(token.name, `action:${name}`, error);
              });
            return result;
          } catch (error) {
            throw new StoreError(token.name, `action:${name}`, error);
          }
        };
      }
      const initial = Object.values(value.state).map((cell) => ({
        cell,
        value: runUntracked(() => snapshot(cell())),
      }));
      let resetting = false;
      const reset = (): void => {
        if (owner.disposed)
          throw new StoreError(token.name, 'reset', new Error('Store is disposed'));
        if (resetting)
          throw new StoreError(token.name, 'reset', new Error('Recursive Store reset'));
        resetting = true;
        const errors: unknown[] = [];
        try {
          try {
            tasks.invalidate('reset');
          } catch (error) {
            errors.push(error);
          }
          if (owner.disposed)
            throw new StoreError(token.name, 'reset', new Error('Store disposed during reset'));
          batch(() => {
            for (const { cell, value } of initial)
              try {
                cell.set(value);
              } catch (error) {
                errors.push(error);
              }
            for (const callback of [...resets]) {
              if (owner.disposed) break;
              try {
                callback();
              } catch (error) {
                errors.push(error);
              }
            }
          });
        } finally {
          resetting = false;
        }
        if (errors.length) throw new StoreError(token.name, 'reset', new AggregateError(errors));
      };
      const dispose = (): void => {
        try {
          owner.dispose();
        } catch (error) {
          throw new StoreError(token.name, 'dispose', error);
        }
      };
      const instance: RuntimeInstance = Object.freeze({
        state,
        getters,
        reset,
        userScoped: token.userScoped,
        actions: Object.freeze(actions),
        dispose,
      });
      providerOwner.assertOpen();
      providerOwner.scope.own(dispose);
      registry.instances.set(token, { owner, value: instance });
      return instance as T;
    } catch (error) {
      try {
        owner.dispose();
      } catch (cleanupError) {
        throw new StoreError(
          token.name,
          'setup',
          new AggregateError([error, cleanupError], 'Store construction and cleanup failed'),
        );
      }
      throw error instanceof StoreError ? error : new StoreError(token.name, 'setup', error);
    } finally {
      registry.creating.pop();
    }
  }
}
