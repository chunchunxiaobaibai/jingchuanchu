import type { CancellationSignal, Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { ComponentOwner, type OwnerResolver } from './component-owner.js';
import { runUntracked } from './reactivity.js';
const SERVICE = Symbol('application service definition'),
  PROVIDER = Symbol('application service provider');
export interface ServiceContext {
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  own(cleanup: Cleanup): Cleanup;
  useService<T>(definition: Token<T>): T;
}
export type ServiceFactory<T> = (context: ServiceContext) => T;
export interface ServiceDefinition<T> extends Token<T> {
  readonly [SERVICE]: true;
  readonly factory: ServiceFactory<T>;
}
export interface ServiceProvider<T> {
  readonly [PROVIDER]: true;
  readonly definition: ServiceDefinition<T>;
  readonly factory: ServiceFactory<T>;
}
type Synchronous<T> = [T] extends [never]
  ? unknown
  : [Extract<T, PromiseLike<unknown>>] extends [never]
    ? unknown
    : never;
export function defineService<T>(
  options: { readonly name: string; readonly factory: ServiceFactory<T> } & Synchronous<T>,
): ServiceDefinition<T> {
  if (typeof options.name !== 'string' || !options.name.trim())
    throw new Error('Service name is required');
  if (typeof options.factory !== 'function')
    throw new Error(`Missing service factory: ${options.name}`);
  return Object.freeze({ ...options, key: Symbol(options.name), [SERVICE]: true as const });
}
export function provideService<T>(
  definition: ServiceDefinition<T>,
  overrideFactory?: ServiceFactory<NoInfer<T>>,
): ServiceProvider<T> {
  if (!definition || definition[SERVICE] !== true) throw new Error('Expected a service definition');
  const factory = overrideFactory ?? definition.factory;
  if (typeof factory !== 'function') throw new Error(`Invalid service factory: ${definition.name}`);
  return Object.freeze({ [PROVIDER]: true as const, definition, factory });
}
export class ServiceError extends Error {
  readonly module = 'application-services';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Service ${source}: ${operation} failed${cause instanceof Error ? `: ${cause.message}` : ''}`,
      { cause },
    );
    this.name = 'ServiceError';
  }
}
/** Internal provider registry; application/page owners supply its resolution boundary. */
export class ServiceRegistry implements OwnerResolver {
  private readonly providers = new Map<Token<unknown>, ServiceFactory<unknown>>();
  private readonly owners = new WeakMap<
    ComponentOwner,
    {
      values: Map<Token<unknown>, { owner: ComponentOwner; value: unknown }>;
      creating: Token<unknown>[];
    }
  >();
  constructor(providers: readonly ServiceProvider<unknown>[] = []) {
    for (const provider of providers) {
      if (!provider || provider[PROVIDER] !== true)
        throw new Error('Expected provideService(...) in providers');
      if (this.providers.has(provider.definition))
        throw new ServiceError(
          provider.definition.name,
          'provide',
          new Error('Duplicate provider in the same owner'),
        );
      this.providers.set(provider.definition, provider.factory);
    }
  }
  has(definition: Token<unknown>): boolean {
    return this.providers.has(definition);
  }
  resolve<T>(definition: Token<T>, providerOwner: ComponentOwner): T {
    if (providerOwner.disposed)
      throw new ServiceError(definition.name, 'resolve', new Error('Provider owner is disposed'));
    const factory = this.providers.get(definition);
    if (!factory)
      throw new ServiceError(definition.name, 'resolve', new Error('Service is not provided'));
    let state = this.owners.get(providerOwner);
    if (!state) {
      state = { values: new Map(), creating: [] };
      this.owners.set(providerOwner, state);
      const values = state.values;
      providerOwner.scope.own(() => values.clear());
    }
    const existing = state.values.get(definition);
    if (existing) {
      if (existing.owner.disposed)
        throw new ServiceError(definition.name, 'resolve', new Error('Service is disposed'));
      return existing.value as T;
    }
    if (state.creating.includes(definition))
      throw new ServiceError(
        definition.name,
        'factory',
        new Error(
          `Circular service dependency: ${[...state.creating, definition].map((item) => item.name).join(' -> ')}`,
        ),
      );
    // Register lifetime only after successful construction: dependants then clean up before dependencies.
    const owner = new ComponentOwner(providerOwner, {}, 'manual');
    state.creating.push(definition);
    try {
      const context: ServiceContext = {
        scope: owner.scope,
        signal: owner.cancellation,
        own: (cleanup) => {
          owner.assertOpen();
          providerOwner.assertOpen();
          return owner.scope.own(cleanup);
        },
        useService: (token) => {
          owner.assertOpen();
          providerOwner.assertOpen();
          try {
            return owner.resolve('services', token);
          } catch (error) {
            throw new ServiceError(definition.name, `resolve:${token.name}`, error);
          }
        },
      };
      const value = runUntracked(() => factory(context));
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw new Error(
          'Service factories must be synchronous; put asynchronous work in service methods',
        );
      }
      owner.assertOpen();
      providerOwner.assertOpen();
      providerOwner.scope.own(() => {
        try {
          owner.dispose();
        } catch (error) {
          throw new ServiceError(definition.name, 'dispose', error);
        }
      });
      state.values.set(definition, { owner, value });
      return value as T;
    } catch (error) {
      try {
        owner.dispose();
      } catch (cleanupError) {
        throw new ServiceError(
          definition.name,
          'factory',
          new AggregateError([error, cleanupError], 'Service construction and cleanup failed'),
        );
      }
      throw error instanceof ServiceError
        ? error
        : new ServiceError(definition.name, 'factory', error);
    } finally {
      state.creating.pop();
    }
  }
}
