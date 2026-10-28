import { snapshot, type ReadonlyData } from '../state.js';
const SAVE = Symbol('save definition');
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface SaveOptions<S, D> {
  readonly key: string;
  readonly version: number;
  readonly select: (state: S) => D;
  readonly parse: (data: unknown) => D;
  readonly migrate?: Readonly<Record<number, (oldData: unknown) => unknown>>;
  readonly restore: (state: S, data: ReadonlyData<D>) => void;
}
export interface SaveDefinition<S, D> extends SaveOptions<S, D> {
  readonly [SAVE]: true;
}
export class SaveError extends Error {
  readonly module = 'save-data';
  readonly source: string;
  constructor(
    readonly key: string,
    readonly operation: string,
    cause: unknown,
    readonly storageKey = '',
  ) {
    super(`Save ${key}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`, {
      cause,
    });
    this.source = key;
    this.name = 'SaveError';
  }
}
export type SaveNamespace =
  { readonly kind: 'anonymous' } | { readonly kind: 'user'; readonly userId: string };
export type SaveResetResult =
  { readonly status: 'reset' } | { readonly status: 'unavailable'; readonly error: SaveError };
export type SaveResult =
  | { readonly status: 'saved' }
  | { readonly status: 'invalid' | 'unavailable'; readonly error: SaveError };
export type SaveLoadResult<D> =
  | { readonly status: 'loaded'; readonly data: ReadonlyData<D>; readonly migratedFrom?: number }
  | { readonly status: 'empty' }
  | { readonly status: 'corrupt' | 'unavailable'; readonly error: SaveError }
  | { readonly status: 'incompatible'; readonly schemaVersion: number; readonly error: SaveError };

export function defineSave<S, D>(options: SaveOptions<S, D>): SaveDefinition<S, D> {
  try {
    if (
      !options ||
      typeof options.key !== 'string' ||
      !options.key.trim() ||
      /[\u0000-\u001f]/.test(options.key)
    )
      throw new Error('Save key must be nonempty');
    encodeURIComponent(options.key);
    if (!Number.isSafeInteger(options.version) || options.version < 1)
      throw new Error('Version must be a positive safe integer');
    if ([options.select, options.parse, options.restore].some((fn) => typeof fn !== 'function'))
      throw new Error('select/parse/restore functions are required');
    for (const [version, migrate] of Object.entries(options.migrate ?? {})) {
      const number = Number(version);
      if (
        !/^[1-9]\d*$/.test(version) ||
        !Number.isSafeInteger(number) ||
        number >= options.version ||
        typeof migrate !== 'function'
      )
        throw new Error('Migrations must explicitly map older versions to current data');
    }
    return Object.freeze({
      ...options,
      ...(options.migrate ? { migrate: Object.freeze({ ...options.migrate }) } : {}),
      [SAVE]: true as const,
    });
  } catch (error) {
    throw new SaveError(options?.key ?? '<save>', 'define', error);
  }
}
function synchronous<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as unknown as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => {});
    throw new Error('select/parse/migrate must be synchronous');
  }
  return value;
}
function jsonData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (
    !value ||
    typeof value !== 'object' ||
    (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
  )
    throw new Error('Save data must contain only finite JSON data');
  if (ancestors.has(value)) throw new Error('Cyclic save data is unsupported');
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error('Symbol fields are not JSON data');
  if (
    Array.isArray(value) &&
    (Object.keys(value).length !== value.length ||
      !Object.keys(value).every((key, index) => key === String(index)))
  )
    throw new Error('Sparse arrays or array properties are unsupported');
  ancestors.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error('Save data must not contain accessors');
    jsonData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

/** Lazy wrapper: no storage lookup or operation occurs until a business save/load/reset call. */
export function createLocalStorageAdapter(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): StorageAdapter {
  const target = () => storage ?? globalThis.localStorage;
  return Object.freeze({
    async get(key: string) {
      return target().getItem(key);
    },
    async set(key: string, value: string) {
      target().setItem(key, value);
    },
    async remove(key: string) {
      target().removeItem(key);
    },
  });
}

export class SaveService {
  private readonly storage: StorageAdapter;
  private readonly prefix: string;
  constructor(options: { storage?: StorageAdapter; namespace?: SaveNamespace } = {}) {
    const namespace = options.namespace ?? { kind: 'anonymous' };
    try {
      if (namespace.kind === 'anonymous') this.prefix = 'jcc:save:anonymous:';
      else if (
        namespace.kind === 'user' &&
        typeof namespace.userId === 'string' &&
        namespace.userId.trim() &&
        !/[\u0000-\u001f]/.test(namespace.userId)
      )
        this.prefix = `jcc:save:user:${encodeURIComponent(namespace.userId)}:`;
      else throw new Error('Expected anonymous or nonempty user namespace');
    } catch (error) {
      throw new SaveError('<namespace>', 'create', error);
    }
    this.storage = options.storage ?? createLocalStorageAdapter();
  }
  private storageKey(key: string): string {
    return this.prefix + encodeURIComponent(key);
  }
  async reset<S, D>(definition: SaveDefinition<S, D>): Promise<SaveResetResult> {
    if (definition?.[SAVE] !== true)
      return {
        status: 'unavailable',
        error: new SaveError(
          definition?.key ?? '<save>',
          'define',
          new Error('Expected defineSave(...)'),
        ),
      };
    const key = this.storageKey(definition.key);
    try {
      await this.storage.remove(key);
      return { status: 'reset' };
    } catch (error) {
      return { status: 'unavailable', error: new SaveError(definition.key, 'remove', error, key) };
    }
  }
  async save<S, D>(definition: SaveDefinition<S, D>, state: S): Promise<SaveResult> {
    if (definition?.[SAVE] !== true)
      return {
        status: 'invalid',
        error: new SaveError(
          definition?.key ?? '<save>',
          'define',
          new Error('Expected defineSave(...)'),
        ),
      };
    const key = this.storageKey(definition.key);
    const fail = (operation: string, cause: unknown) =>
      new SaveError(definition.key, operation, cause, key);
    let encoded: string,
      operation = 'select';
    try {
      const selected = synchronous(definition.select(state));
      jsonData(selected);
      operation = 'parse';
      const data = synchronous(definition.parse(snapshot(selected)));
      jsonData(data);
      operation = 'encode';
      encoded = JSON.stringify({ schemaVersion: definition.version, data });
    } catch (error) {
      return { status: 'invalid', error: fail(operation, error) };
    }
    try {
      await this.storage.set(key, encoded);
      return { status: 'saved' };
    } catch (error) {
      return { status: 'unavailable', error: fail('set', error) };
    }
  }
  async load<S, D>(definition: SaveDefinition<S, D>): Promise<SaveLoadResult<D>> {
    if (definition?.[SAVE] !== true)
      return {
        status: 'corrupt',
        error: new SaveError(
          definition?.key ?? '<save>',
          'define',
          new Error('Expected defineSave(...)'),
        ),
      };
    const key = this.storageKey(definition.key);
    const fail = (operation: string, cause: unknown) =>
      new SaveError(definition.key, operation, cause, key);
    let raw: string | null;
    try {
      raw = await this.storage.get(key);
      if (raw !== null && typeof raw !== 'string')
        throw new Error('Storage get must return a string or null');
    } catch (error) {
      return { status: 'unavailable', error: fail('get', error) };
    }
    if (raw === null) return { status: 'empty' };
    let operation = 'decode';
    try {
      const record: unknown = JSON.parse(raw);
      if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        !Object.hasOwn(record, 'schemaVersion') ||
        !Object.hasOwn(record, 'data')
      )
        throw new Error('Invalid save envelope');
      const envelope = record as { schemaVersion: unknown; data: unknown };
      if (
        typeof envelope.schemaVersion !== 'number' ||
        !Number.isSafeInteger(envelope.schemaVersion) ||
        envelope.schemaVersion < 1
      )
        throw new Error('Invalid schemaVersion');
      let data = envelope.data;
      const version = envelope.schemaVersion;
      if (version !== definition.version) {
        if (version > definition.version || !Object.hasOwn(definition.migrate ?? {}, version))
          return {
            status: 'incompatible',
            schemaVersion: version,
            error: fail('version', new Error('Unsupported save version')),
          };
        operation = 'migrate';
        data = synchronous(definition.migrate![version]!(data));
      }
      operation = 'parse';
      const parsed = synchronous(definition.parse(data));
      jsonData(parsed);
      return {
        status: 'loaded',
        data: snapshot(parsed),
        ...(version !== definition.version ? { migratedFrom: version } : {}),
      };
    } catch (error) {
      return { status: 'corrupt', error: fail(operation, error) };
    }
  }
}
