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

export interface BulkQueryIterator<T = Entity> {
  buffer: Entity[];
  next(): IteratorResult<BulkQueryIterator<T>>;
  return?(): void;
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
  require(index: number, name: string): T {
    const slot = this.sparse.get(index);
    if (slot === undefined) throw new Error(`Missing component: ${name}`);
    return this.values[slot] as T;
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

class BulkQueryIteratorImpl implements BulkQueryIterator {
  buffer: Entity[];
  private world: World;
  private stores: SparseSet<unknown>[];
  private done = false;

  constructor(world: World, buffer: Entity[], stores: SparseSet<unknown>[]) {
    this.buffer = buffer;
    // Access private field using bracket notation
    const worldRef = world as any;
    this.world = world;
    this.stores = stores;
  }

  next(): IteratorResult<BulkQueryIterator> {
    if (this.done) {
      return { done: true, value: undefined };
    }
    // Mark as tracking component modifications
    const worldRef = this.world as any;
    worldRef.bulkIteratorActive = this;
    return { done: false, value: this };
  }

  return(): void {
    this.done = true;
    const worldRef = this.world as any;
    worldRef.bulkIteratorActive = undefined;
  }
}

export class World {
  private readonly id = Symbol('World');
  private readonly generations: number[] = [];
  private readonly handles: Array<Entity | undefined> = [];
  private readonly alive = new Set<number>();
  private readonly free: number[] = [];
  private readonly stores = new Map<symbol, SparseSet<unknown>>();
  private readonly resources = new Map<symbol, unknown>();
  private commands: Array<(world: World) => void> = [];
  private bulkIteratorActive: BulkQueryIteratorImpl | undefined;
  private disposed = false;
  get size(): number {
    return this.alive.size;
  }
  create(): Entity {
    this.assertOpen();
    const index = this.free.pop() ?? this.generations.length;
    this.generations[index] ??= 0;
    this.alive.add(index);
    const entity = Object.freeze({ worldId: this.id, index, generation: this.generations[index]! });
    this.handles[index] = entity;
    return entity;
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
    this.handles[entity.index] = undefined;
    this.generations[entity.index]!++;
    this.free.push(entity.index);
    return true;
  }
  set<T>(entity: Entity, token: Token<T>, value: NoInfer<T>): void {
    this.assertAlive(entity);
    if (this.bulkIteratorActive) {
      throw new Error('Cannot modify components during bulkQuery iteration');
    }
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
    const store = this.stores.get(token.key);
    if (!store) throw new Error(`Missing component: ${token.name}`);
    return store.require(entity.index, token.name) as T;
  }
  has<T>(entity: Entity, token: Token<T>): boolean {
    return this.isAlive(entity) && (this.stores.get(token.key)?.has(entity.index) ?? false);
  }
  remove<T>(entity: Entity, token: Token<T>): void {
    this.assertAlive(entity);
    if (this.bulkIteratorActive) {
      throw new Error('Cannot modify components during bulkQuery iteration');
    }
    this.stores.get(token.key)?.delete(entity.index);
  }
  *query(...tokens: Token<unknown>[]): IterableIterator<Entity> {
    this.assertOpen();
    const stores: SparseSet<unknown>[] = [];
    let smallest: SparseSet<unknown> | undefined;
    for (const token of tokens) {
      const store = this.stores.get(token.key);
      if (!store) return;
      stores.push(store);
      if (!smallest || store.indices.length < smallest.indices.length) smallest = store;
    }
    // Snapshot handles prevent recycled indices from entering an active traversal.
    // Copy straight into that snapshot; an intermediate index copy is unnecessary.
    const indices = smallest?.indices;
    const entities = new Array<Entity>(indices ? indices.length : this.alive.size);
    if (indices) {
      for (let i = 0; i < indices.length; i++) entities[i] = this.handles[indices[i]!]!;
    } else {
      let i = 0;
      for (const index of this.alive) entities[i++] = this.handles[index]!;
    }
    candidates: for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      if (!this.isAlive(entity)) continue;
      for (let j = 0; j < stores.length; j++)
        if (!stores[j]!.has(entity.index)) continue candidates;
      yield entity;
    }
  }
  bulkQuery(...tokens: Token<unknown>[]): BulkQueryIterator {
    this.assertOpen();
    const stores: SparseSet<unknown>[] = [];
    let smallest: SparseSet<unknown> | undefined;
    for (const token of tokens) {
      const store = this.stores.get(token.key);
      if (!store) {
        // No store for this token, empty result
        return new BulkQueryIteratorImpl(this, [], []);
      }
      stores.push(store);
      if (!smallest || store.indices.length < smallest.indices.length) smallest = store;
    }
    // Build filtered buffer
    const indices = smallest?.indices;
    const candidateIndices = indices ? Array.from(indices) : Array.from(this.alive);
    const buffer: Entity[] = [];
    candidates: for (let i = 0; i < candidateIndices.length; i++) {
      const index = candidateIndices[i]!;
      const entity = this.handles[index];
      if (!entity || !this.isAlive(entity)) continue;
      for (let j = 0; j < stores.length; j++)
        if (!stores[j]!.has(index)) continue candidates;
      buffer.push(entity);
    }
    return new BulkQueryIteratorImpl(this, buffer, stores);
  }
  setResource<T>(token: Token<T>, value: NoInfer<T>): void {
    this.assertOpen();
    this.resources.set(token.key, value);
  }
  getResource<T>(token: Token<T>): T {
    this.assertOpen();
    if (!this.resources.has(token.key)) throw new Error(`Missing resource: ${token.name}`);
    return this.resources.get(token.key) as T;
  }
  hasResource<T>(token: Token<T>): boolean {
    this.assertOpen();
    return this.resources.has(token.key);
  }
  removeResource<T>(token: Token<T>): boolean {
    this.assertOpen();
    return this.resources.delete(token.key);
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
    this.handles.length = 0;
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
