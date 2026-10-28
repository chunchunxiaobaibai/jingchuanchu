import { Cancellation, Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';

export interface OwnerResolver {
  has(token: Token<unknown>): boolean;
  resolve<T>(token: Token<T>, owner: ComponentOwner): T;
}

/** Shared owner protocol for components and explicitly owned resources. */
export class ComponentOwner {
  readonly scope = new Scope();
  readonly cancellation = new Cancellation();
  private readonly ownedChildren = new Set<ComponentOwner>();
  private readonly contexts = new Map<symbol, unknown>();
  beforeDispose?: Cleanup;
  afterDispose?: Cleanup;
  private closed = false;
  private locallyActive = true;
  private readonly activityListeners = new Set<(active: boolean) => void>();
  private offActivityParent: Cleanup | undefined;
  private lastActivity = true;
  constructor(
    readonly parent?: ComponentOwner,
    readonly resolvers: { services?: OwnerResolver; stores?: OwnerResolver } = {},
    ownership: 'child' | 'manual' = 'child',
  ) {
    parent?.assertOpen();
    if (ownership === 'child') parent?.ownedChildren.add(this);
  }
  get disposed(): boolean {
    return this.closed;
  }
  get active(): boolean {
    return !this.closed && this.locallyActive && (this.parent?.active ?? true);
  }
  private notifyActivity = (): void => {
    const active = this.active;
    if (active === this.lastActivity) return;
    this.lastActivity = active;
    const errors: unknown[] = [];
    for (const listener of [...this.activityListeners])
      if (this.activityListeners.has(listener))
        try {
          listener(active);
        } catch (error) {
          errors.push(error);
        }
    if (errors.length) throw new AggregateError(errors, 'Owner activity notification failed');
  };
  setActive(active: boolean): void {
    this.assertOpen();
    if (this.locallyActive === active) return;
    this.locallyActive = active;
    this.notifyActivity();
  }
  onActivity(listener: (active: boolean) => void): Cleanup {
    this.assertOpen();
    if (!this.activityListeners.size) {
      this.lastActivity = this.active;
      this.offActivityParent = this.parent?.onActivity(this.notifyActivity);
    }
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
      if (!this.activityListeners.size) {
        this.offActivityParent?.();
        this.offActivityParent = undefined;
      }
    };
  }
  get children(): ReadonlySet<ComponentOwner> {
    return this.ownedChildren;
  }
  assertOpen(): void {
    if (this.closed) throw new Error('Component owner is disposed');
  }
  provideContext<T>(key: symbol, value: T): void {
    this.assertOpen();
    if (this.contexts.has(key)) throw new Error(`Duplicate component context: ${key.description}`);
    this.contexts.set(key, value);
  }
  getContext<T>(key: symbol): T {
    this.assertOpen();
    for (let owner: ComponentOwner | undefined = this; owner; owner = owner.parent)
      if (owner.contexts.has(key)) return owner.contexts.get(key) as T;
    throw new Error(`Missing component context: ${key.description}`);
  }
  resolve<T>(kind: 'services' | 'stores', token: Token<T>): T {
    if (this.closed)
      throw new Error(
        `Cannot resolve ${kind === 'services' ? 'service' : 'store'} ${token.name}: owner is disposed`,
      );
    for (let owner: ComponentOwner | undefined = this; owner; owner = owner.parent) {
      const resolver = owner.resolvers[kind];
      if (resolver?.has(token)) return resolver.resolve(token, owner);
    }
    throw new Error(`Missing ${kind === 'stores' ? 'store' : 'service'}: ${token.name}`);
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const action of [
      ...[...this.ownedChildren].reverse().map((child) => () => child.dispose()),
      () => this.beforeDispose?.(),
      () => this.cancellation.cancel(),
      () => this.scope.dispose(),
      () => {
        this.offActivityParent?.();
        this.offActivityParent = undefined;
        this.activityListeners.clear();
      },
      () => this.afterDispose?.(),
    ]) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }
    this.ownedChildren.clear();
    this.contexts.clear();
    this.parent?.ownedChildren.delete(this);
    if (errors.length) throw new AggregateError(errors, 'Component owner cleanup failed');
  }
}
