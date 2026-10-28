import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineSave,
  SaveService,
  SaveError,
  createLocalStorageAdapter,
  type StorageAdapter,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
interface State {
  score: number;
  token: string;
  engine: () => void;
}
function memory() {
  const values = new Map<string, string>();
  let writes = 0,
    removes = 0;
  const adapter: StorageAdapter = {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      writes++;
      values.set(key, value);
    },
    async remove(key) {
      removes++;
      values.delete(key);
    },
  };
  return { values, adapter, writes: () => writes, removes: () => removes };
}
function definition() {
  let restored = 0;
  const save = defineSave({
    key: 'game:progress',
    version: 2,
    select: (state: State) => ({ score: state.score }),
    parse(value: unknown) {
      if (
        !value ||
        typeof value !== 'object' ||
        !('score' in value) ||
        typeof value.score !== 'number' ||
        !Number.isFinite(value.score) ||
        value.score < 0
      )
        throw new Error('Invalid score');
      return { score: value.score };
    },
    migrate: { 1: (data: unknown) => ({ score: (data as { points: number }).points }) },
    restore(state: State, data) {
      restored++;
      state.score = data.score;
    },
  });
  return { save, restored: () => restored };
}
const key = 'jcc:save:anonymous:game%3Aprogress';

test('save selects only declared JSON fields and load returns readonly data without restoring business state', async () => {
  const m = memory(),
    service = new SaveService({ storage: m.adapter }),
    d = definition();
  const state: State = { score: 42, token: 'private', engine() {} };
  assert.deepEqual(await service.load(d.save), { status: 'empty' });
  assert.deepEqual(await service.save(d.save, state), { status: 'saved' });
  assert.deepEqual(JSON.parse(m.values.get(key)!), { schemaVersion: 2, data: { score: 42 } });
  state.score = 0;
  const result = await service.load(d.save);
  assert.equal(result.status, 'loaded');
  assert.equal(state.score, 0);
  assert.equal(d.restored(), 0);
  if (result.status === 'loaded') {
    assert.equal(result.data.score, 42);
    assert.equal(Reflect.set(result.data, 'score', 2), false);
    d.save.restore(state, result.data);
  }
  assert.equal(state.score, 42);
  assert.equal(d.restored(), 1);
  assert.equal(m.writes(), 1);
});

test('only declared old versions migrate through current parse and no load rewrites the original record', async () => {
  const m = memory(),
    service = new SaveService({ storage: m.adapter }),
    d = definition();
  const old = JSON.stringify({ schemaVersion: 1, data: { points: 9 } });
  m.values.set(key, old);
  const migrated = await service.load(d.save);
  assert.equal(migrated.status, 'loaded');
  if (migrated.status === 'loaded') {
    assert.deepEqual(migrated.data, { score: 9 });
    assert.equal(migrated.migratedFrom, 1);
  }
  assert.equal(m.values.get(key), old);
  assert.equal(m.writes(), 0);
  assert.equal(m.removes(), 0);
  m.values.set(key, JSON.stringify({ schemaVersion: 3, data: { score: 8 } }));
  const future = await service.load(d.save);
  assert.equal(future.status, 'incompatible');
  assert.equal(m.removes(), 0);
  m.values.set(key, JSON.stringify({ schemaVersion: 1, data: { points: -1 } }));
  const invalid = await service.load(d.save);
  assert.equal(invalid.status, 'corrupt');
  if (invalid.status === 'corrupt') assert.equal(invalid.error.operation, 'parse');
});

test('non-JSON selections and asynchronous parsers fail before writing and retain operation/cause diagnostics', async () => {
  const m = memory(),
    service = new SaveService({ storage: m.adapter });
  const invalid = defineSave({
    key: 'invalid',
    version: 1,
    select: () => ({ value: Infinity }),
    parse: (value) => value,
    restore() {},
  });
  const result = await service.save(invalid, undefined);
  assert.equal(result.status, 'invalid');
  assert.equal(m.writes(), 0);
  if (result.status === 'invalid') {
    assert.ok(result.error instanceof SaveError);
    assert.equal(result.error.key, 'invalid');
    assert.equal(result.error.operation, 'select');
  }
  const bad = defineSave({
    key: 'async',
    version: 1,
    select: () => ({ score: 1 }),
    // @ts-expect-error parsers must return the selected DTO synchronously
    parse: () => Promise.reject(new Error('async parse')),
    restore() {},
  });
  assert.equal((await service.save(bad, undefined)).status, 'invalid');
  await Promise.resolve();
  assert.equal(m.writes(), 0);
  assert.throws(
    () =>
      defineSave({
        key: 'bad-migration',
        version: 2,
        select: () => 0,
        parse: () => 0,
        migrate: { 2: () => 0 },
        restore() {},
      }),
    SaveError,
  );
});

test('injected localStorage wrapper converts host access failures to unavailable without changing business state', async () => {
  const cause = new Error('storage blocked');
  const storage = createLocalStorageAdapter({
    getItem() {
      throw cause;
    },
    setItem() {
      throw cause;
    },
    removeItem() {
      throw cause;
    },
  });
  const service = new SaveService({ storage }),
    d = definition(),
    state: State = { score: 3, token: 'private', engine() {} };
  const load = await service.load(d.save);
  assert.equal(load.status, 'unavailable');
  if (load.status === 'unavailable') {
    assert.equal(load.error.operation, 'get');
    assert.equal(load.error.cause, cause);
  }
  const save = await service.save(d.save, state);
  assert.equal(save.status, 'unavailable');
  if (save.status === 'unavailable') {
    assert.equal(save.error.operation, 'set');
    assert.equal(save.error.cause, cause);
  }
  assert.equal(state.score, 3);
  assert.equal(d.restored(), 0);
});

test('anonymous and immutable user namespaces isolate records and reset removes only the selected record', async () => {
  const m = memory(),
    d = definition(),
    anonymous = new SaveService({ storage: m.adapter });
  const namespace = { kind: 'user' as const, userId: 'alice' };
  const alice = new SaveService({ storage: m.adapter, namespace }),
    bob = new SaveService({ storage: m.adapter, namespace: { kind: 'user', userId: 'bob' } });
  const state = (score: number): State => ({ score, token: 'private', engine() {} });
  await anonymous.save(d.save, state(1));
  await alice.save(d.save, state(2));
  await bob.save(d.save, state(3));
  namespace.userId = 'bob';
  for (const [service, score] of [
    [anonymous, 1],
    [alice, 2],
    [bob, 3],
  ] as const) {
    const loaded = await service.load(d.save);
    assert.equal(loaded.status, 'loaded');
    if (loaded.status === 'loaded') assert.equal(loaded.data.score, score);
  }
  assert.equal(m.values.size, 3);
  assert.ok(m.values.has(key));
  assert.deepEqual(await alice.reset(d.save), { status: 'reset' });
  assert.deepEqual(await alice.load(d.save), { status: 'empty' });
  assert.equal((await bob.load(d.save)).status, 'loaded');
  assert.equal((await anonymous.load(d.save)).status, 'loaded');
  assert.equal(d.restored(), 0);
  assert.throws(
    () => new SaveService({ storage: m.adapter, namespace: { kind: 'user', userId: '' } }),
    SaveError,
  );
});

test('corrupt JSON/envelopes and unavailable resets retain original records without implicit fallback or deletion', async () => {
  const m = memory(),
    d = definition(),
    service = new SaveService({ storage: m.adapter });
  for (const raw of [
    '{bad',
    JSON.stringify({ data: { score: 1 } }),
    JSON.stringify({ schemaVersion: 0, data: { score: 1 } }),
    JSON.stringify({ schemaVersion: 2, data: { score: 'bad' } }),
  ]) {
    m.values.set(key, raw);
    const result = await service.load(d.save);
    assert.equal(result.status, 'corrupt');
    assert.equal(m.values.get(key), raw);
  }
  assert.equal(m.removes(), 0);
  assert.equal(m.writes(), 0);
  assert.equal(d.restored(), 0);
  const cause = new Error('remove denied');
  const failing = new SaveService({
    storage: {
      ...m.adapter,
      async remove() {
        throw cause;
      },
    },
  });
  const before = m.values.get(key);
  const result = await failing.reset(d.save);
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') {
    assert.equal(result.error.operation, 'remove');
    assert.equal(result.error.cause, cause);
  }
  assert.equal(m.values.get(key), before);
});

test('a user switch invalidates the business task commit while a previous namespace load resolves late', async () => {
  const { ComponentOwner } = await import('../packages/app/runtime/component-owner.js');
  const { StoreTasks } = await import('../packages/app/runtime/store-tasks.js');
  const owner = new ComponentOwner(),
    tasks = new StoreTasks(owner, (_operation, cause) => cause as Error),
    d = definition();
  let finish!: (value: string | null) => void;
  const alice = new SaveService({
    storage: {
      get: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      async set() {},
      async remove() {},
    },
    namespace: { kind: 'user', userId: 'alice' },
  });
  const business: State = { score: 0, token: 'not persisted', engine() {} };
  const restore = tasks.run(async (task) => {
    const loaded = await alice.load(d.save);
    if (loaded.status === 'loaded') return task.commit(() => d.save.restore(business, loaded.data));
    return undefined;
  });
  tasks.invalidate('user changed');
  assert.deepEqual(await restore, { status: 'cancelled' });
  business.score = 99;
  finish(JSON.stringify({ schemaVersion: 2, data: { score: 2 } }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(business.score, 99);
  assert.equal(d.restored(), 0);
  owner.dispose();
});
