/** Tokens are unique by identity, even when display names match. */
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: T;
}
export const component = <T>(name: string): Token<T> => Object.freeze({ key: Symbol(name), name });
export const resource = component;
export interface Entity {
  readonly worldId: symbol;
  readonly index: number;
  readonly generation: number;
}

/** Dense iteration and O(1) swap removal; sparse indices are kept in a Map. */
class SparseSet<T> {
  private readonly sparse = new Map<number, number>();
  readonly indices: number[] = [];
  private readonly values: T[] = [];
  has(index: number): boolean {
    return this.sparse.has(index);
  }
  get(index: number): T | undefined {
    const slot = this.sparse.get(index);
    return slot === undefined ? undefined : this.values[slot];
  }
  set(index: number, value: T): void {
    const slot = this.sparse.get(index);
    if (slot !== undefined) {
      this.values[slot] = value;
      return;
    }
    this.sparse.set(index, this.indices.length);
    this.indices.push(index);
    this.values.push(value);
  }
  delete(index: number): void {
    const slot = this.sparse.get(index);
    if (slot === undefined) return;
    const last = this.indices.length - 1;
    if (slot !== last) {
      const moved = this.indices[last]!;
      this.indices[slot] = moved;
      this.values[slot] = this.values[last]!;
      this.sparse.set(moved, slot);
    }
    this.indices.pop();
    this.values.pop();
    this.sparse.delete(index);
  }
}

export class World {
  private readonly id = Symbol('World');
  private readonly generations: number[] = [];
  private readonly alive = new Set<number>();
  private readonly free: number[] = [];
  private readonly stores = new Map<symbol, SparseSet<unknown>>();
  private readonly resources = new Map<symbol, unknown>();
  private commands: Array<(world: World) => void> = [];
  private disposed = false;
  get size(): number {
    return this.alive.size;
  }
  create(): Entity {
    this.assertOpen();
    const index = this.free.pop() ?? this.generations.length;
    this.generations[index] ??= 0;
    this.alive.add(index);
    return Object.freeze({ worldId: this.id, index, generation: this.generations[index]! });
  }
  isAlive(entity: Entity): boolean {
    return (
      !this.disposed &&
      entity.worldId === this.id &&
      this.alive.has(entity.index) &&
      this.generations[entity.index] === entity.generation
    );
  }
  destroy(entity: Entity): boolean {
    if (!this.isAlive(entity)) return false;
    for (const store of this.stores.values()) store.delete(entity.index);
    this.alive.delete(entity.index);
    this.generations[entity.index]!++;
    this.free.push(entity.index);
    return true;
  }
  set<T>(entity: Entity, token: Token<T>, value: T): void {
    this.assertAlive(entity);
    let store = this.stores.get(token.key);
    if (!store) {
      store = new SparseSet();
      this.stores.set(token.key, store);
    }
    store.set(entity.index, value);
  }
  get<T>(entity: Entity, token: Token<T>): T | undefined {
    if (!this.isAlive(entity)) return undefined;
    return this.stores.get(token.key)?.get(entity.index) as T | undefined;
  }
  require<T>(entity: Entity, token: Token<T>): T {
    this.assertAlive(entity);
    if (!this.has(entity, token)) throw new Error(`Missing component: ${token.name}`);
    return this.get(entity, token) as T;
  }
  has<T>(entity: Entity, token: Token<T>): boolean {
    return this.isAlive(entity) && (this.stores.get(token.key)?.has(entity.index) ?? false);
  }
  remove<T>(entity: Entity, token: Token<T>): void {
    this.assertAlive(entity);
    this.stores.get(token.key)?.delete(entity.index);
  }
  *query(...tokens: Token<unknown>[]): IterableIterator<Entity> {
    this.assertOpen();
    const stores = tokens.map((token) => this.stores.get(token.key));
    if (stores.some((store) => !store)) return;
    const smallest = stores.reduce<SparseSet<unknown> | undefined>(
      (best, store) => (!best || store!.indices.length < best.indices.length ? store : best),
      undefined,
    );
    const candidates = smallest ? [...smallest.indices] : [...this.alive];
    // Snapshot handles prevent recycled indices from entering an active traversal.
    const entities = candidates.map((index) =>
      Object.freeze({ worldId: this.id, index, generation: this.generations[index]! }),
    );
    for (const entity of entities)
      if (this.isAlive(entity) && stores.every((store) => store!.has(entity.index))) yield entity;
  }
  setResource<T>(token: Token<T>, value: T): void {
    this.assertOpen();
    this.resources.set(token.key, value);
  }
  getResource<T>(token: Token<T>): T {
    this.assertOpen();
    if (!this.resources.has(token.key)) throw new Error(`Missing resource: ${token.name}`);
    return this.resources.get(token.key) as T;
  }
  defer(command: (world: World) => void): void {
    this.assertOpen();
    this.commands.push(command);
  }
  flush(): void {
    this.assertOpen();
    const commands = this.commands;
    this.commands = [];
    for (const command of commands) {
      if (this.disposed) break;
      command(this);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.alive.clear();
    this.stores.clear();
    this.resources.clear();
    this.commands = [];
  }
  private assertOpen(): void {
    if (this.disposed) throw new Error('World is disposed');
  }
  private assertAlive(entity: Entity): void {
    this.assertOpen();
    if (!this.isAlive(entity)) throw new Error('Stale or destroyed entity');
  }
}
