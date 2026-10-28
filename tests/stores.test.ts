import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineStore,
  defineComponent,
  mountComponent,
  signal,
  computed,
  effect,
  batch,
  nextTick,
  StoreError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { StoreRegistry } from '../packages/app/runtime/store.js';

function application(registry = new StoreRegistry([], { automatic: true })) {
  return new ComponentOwner(undefined, { stores: registry });
}

test('stores are lazy, shared at their provider owner and isolated across applications and page overrides', () => {
  let constructed = 0;
  const released: number[] = [];
  const Game = defineStore({
    name: 'game-session',
    setup(context) {
      const id = ++constructed,
        count = signal(0);
      context.own(() => {
        released.push(id);
      });
      return {
        state: { count },
        getters: {},
        actions: { add: (amount: number) => count.update((n) => n + amount) },
      };
    },
  });
  const registry = new StoreRegistry([], { automatic: true }),
    first = application(registry),
    second = application(registry),
    page = new ComponentOwner(first),
    sibling = new ComponentOwner(first);
  assert.equal(constructed, 0);
  const shared = page.resolve('stores', Game);
  assert.equal(sibling.resolve('stores', Game), shared);
  assert.equal(first.resolve('stores', Game), shared);
  const other = second.resolve('stores', Game),
    privatePage = new ComponentOwner(first, { stores: new StoreRegistry([Game]) }),
    privateStore = privatePage.resolve('stores', Game);
  assert.equal(constructed, 3);
  shared.actions.add(3);
  assert.equal(other.state.count(), 0);
  assert.equal(privateStore.state.count(), 0);
  page.dispose();
  assert.deepEqual(released, []);
  privatePage.dispose();
  assert.deepEqual(released, [3]);
  assert.throws(() => privateStore.actions.add(1), /Store game-session.*action:add.*disposed/);
  assert.equal(sibling.resolve('stores', Game), shared);
  first.dispose();
  second.dispose();
  assert.deepEqual(released, [3, 1, 2]);
});

test('readonly readers retain reactive selection and explicit batches publish one derived update', async () => {
  const Game = defineStore({
    name: 'score',
    setup() {
      const score = signal(1),
        profile = signal({ name: 'player' }),
        unused = signal(0);
      return {
        state: { score, profile, unused },
        getters: { double: computed(() => score() * 2) },
        actions: {
          add: (value: number) => {
            score.update((n) => n + value);
            return score();
          },
          pair: () =>
            batch(() => {
              score.set(3);
              score.set(4);
            }),
          rename: (name: string) => profile.set({ name }),
          other: () => unused.update((n) => n + 1),
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game),
    scope = new Scope(),
    seen: number[] = [];
  assert.equal('set' in store.state.score, false);
  assert.equal(Object.isFrozen(store.state), true);
  assert.equal(Object.isFrozen(store.actions), true);
  assert.equal(Reflect.set(store.state.profile(), 'name', 'mutated'), false);
  assert.equal(store.state.profile().name, 'player');
  effect(() => {
    seen.push(store.getters.double());
  }, scope);
  await nextTick();
  store.actions.other();
  await nextTick();
  assert.deepEqual(seen, [2]);
  store.actions.pair();
  await nextTick();
  assert.deepEqual(seen, [2, 8]);
  assert.equal(store.actions.add(2), 6);
  store.actions.rename('new');
  assert.equal(store.state.profile().name, 'new');
  scope.dispose();
  owner.dispose();
});

test('cyclic and failed store construction report sources, reclaim candidates and permit a retry', () => {
  const empty = () => ({ state: {}, getters: {}, actions: {} });
  const A = defineStore({
    name: 'alpha',
    setup(context): ReturnType<typeof empty> {
      context.useStore(B);
      return empty();
    },
  });
  const B = defineStore({
    name: 'beta',
    setup(context): ReturnType<typeof empty> {
      context.useStore(A);
      return empty();
    },
  });
  const owner = application();
  assert.throws(() => owner.resolve('stores', A), /alpha -> beta -> alpha/);
  assert.equal(owner.children.size, 0);
  let attempts = 0,
    cleaned = 0;
  const Retry = defineStore({
    name: 'retry',
    setup(context) {
      context.own(() => {
        cleaned++;
      });
      if (++attempts === 1) throw new Error('not ready');
      return { state: { count: signal(1) }, getters: {}, actions: {} };
    },
  });
  assert.throws(() => owner.resolve('stores', Retry), /Store retry.*setup.*not ready/);
  assert.equal(cleaned, 1);
  assert.equal(owner.children.size, 0);
  assert.equal(owner.resolve('stores', Retry).state.count(), 1);
  assert.equal(attempts, 2);
  owner.dispose();
  assert.equal(cleaned, 2);
});

test('action parameters/results survive wrapping and rejected async work retains store and operation sources', async () => {
  const original = new Error('request failed');
  const Game = defineStore({
    name: 'request-state',
    setup() {
      return {
        state: {},
        getters: {},
        actions: {
          sum: (a: number, b: number) => a + b,
          fail() {
            throw original;
          },
          async load() {
            throw original;
          },
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game);
  assert.equal(store.actions.sum(2, 3), 5);
  assert.throws(
    () => store.actions.fail(),
    (error) =>
      error instanceof StoreError &&
      error.source === 'request-state' &&
      error.operation === 'action:fail' &&
      error.cause === original,
  );
  await assert.rejects(
    store.actions.load(),
    (error) =>
      error instanceof StoreError && error.operation === 'action:load' && error.cause === original,
  );
  owner.dispose();
  assert.throws(() => store.actions.sum(1, 2), /disposed/);
});

test('component contexts resolve a shared owner store and update both views without transferring ownership', async () => {
  let cleaned = 0;
  const Game = defineStore({
    name: 'component-score',
    setup(context) {
      const count = signal(1);
      context.own(() => {
        cleaned++;
      });
      return {
        state: { count },
        getters: {},
        actions: { set: (value: number) => count.set(value) },
      };
    },
  });
  const Hud = defineComponent({
    selector: 'store-hud',
    $template: '<span>{{ count }}</span>',
    $bindings: [
      {
        path: [0, 0],
        kind: 'text',
        name: '0',
        source: 'store-hud.html:1',
        evaluate: (scope) => scope.count,
      },
    ],
    setup(context) {
      return { count: context.useStore(Game).state.count };
    },
  });
  const window = new Window(),
    first = window.document.createElement('div') as unknown as HTMLElement,
    second = window.document.createElement('div') as unknown as HTMLElement,
    owner = application();
  const one = mountComponent(first, Hud, { owner }),
    two = mountComponent(second, Hud, { owner }),
    store = owner.resolve('stores', Game);
  await nextTick();
  assert.equal(first.textContent, '1');
  assert.equal(second.textContent, '1');
  store.actions.set(3);
  await nextTick();
  assert.equal(first.textContent, '3');
  assert.equal(second.textContent, '3');
  one.dispose();
  assert.equal(cleaned, 0);
  store.actions.set(4);
  await nextTick();
  assert.equal(first.textContent, '');
  assert.equal(second.textContent, '4');
  two.dispose();
  assert.equal(cleaned, 0);
  owner.dispose();
  assert.equal(cleaned, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('reset retains instance/readers/actions, restores initial snapshots and batches reset notifications', async () => {
  let calls = 0;
  const Game = defineStore({
    name: 'reset-state',
    userScoped: true,
    setup(context) {
      const count = signal(1),
        profile = signal({ name: 'initial' });
      context.onReset(() => {
        calls++;
      });
      const remove = context.onReset(() => {
        throw new Error('removed');
      });
      remove();
      return {
        state: { count, profile },
        getters: { double: computed(() => count() * 2) },
        actions: {
          change() {
            count.set(8);
            profile.set({ name: 'changed' });
          },
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game),
    reader = store.state.count,
    action = store.actions.change,
    derived = store.getters.double,
    scope = new Scope(),
    seen: string[] = [];
  assert.equal(Game.userScoped, true);
  assert.equal(store.userScoped, true);
  effect(() => {
    seen.push(`${reader()}:${store.state.profile().name}`);
  }, scope);
  await nextTick();
  store.actions.change();
  await nextTick();
  store.reset();
  await nextTick();
  assert.equal(owner.resolve('stores', Game), store);
  assert.equal(store.state.count, reader);
  assert.equal(store.actions.change, action);
  assert.equal(store.getters.double, derived);
  assert.equal(derived(), 2);
  assert.deepEqual(seen, ['1:initial', '8:changed', '1:initial']);
  assert.equal(calls, 1);
  store.reset();
  assert.equal(calls, 2);
  scope.dispose();
  owner.dispose();
  assert.throws(() => store.reset(), /disposed/);
});

test('same-key tasks cancel previous submissions while independent tasks and completed values remain typed', async () => {
  const contexts: import('@xiaobaibaifqy/jingchuanchu-app/application').StoreTaskContext[] = [];
  const Game = defineStore({
    name: 'task-state',
    setup(context) {
      const count = signal(0);
      return {
        state: { count },
        getters: {},
        actions: {
          load: (promise: Promise<number>, key?: string) =>
            context.runTask(
              async (task) => {
                contexts.push(task);
                const value = await promise;
                return task.commit(() => {
                  count.set(value);
                  return value;
                });
              },
              key === undefined ? {} : { key },
            ),
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game),
    old = deferred<number>(),
    newer = deferred<number>();
  const first = store.actions.load(old.promise, 'search'),
    second = store.actions.load(newer.promise, 'search');
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.equal(contexts[0]!.signal.aborted, true);
  newer.resolve(2);
  assert.deepEqual(await second, { status: 'completed', value: { status: 'committed', value: 2 } });
  assert.equal(store.state.count(), 2);
  old.resolve(99);
  await nextTick();
  assert.equal(store.state.count(), 2);
  assert.deepEqual(
    contexts[0]!.commit(() => {
      throw new Error('stale');
    }),
    { status: 'cancelled' },
  );
  assert.deepEqual(
    contexts[1]!.commit(() => {
      throw new Error('completed');
    }),
    { status: 'cancelled' },
  );
  const a = deferred<number>(),
    b = deferred<number>(),
    one = store.actions.load(a.promise),
    two = store.actions.load(b.promise);
  a.resolve(3);
  await one;
  assert.equal(store.state.count(), 3);
  b.resolve(4);
  await two;
  assert.equal(store.state.count(), 4);
  owner.dispose();
});

test('reset and dispose cancel waiting tasks immediately and late I/O cannot commit or reject unhandled', async () => {
  const contexts: import('@xiaobaibaifqy/jingchuanchu-app/application').StoreTaskContext[] = [];
  const Game = defineStore({
    name: 'cancel-state',
    setup(context) {
      const count = signal(1);
      return {
        state: { count },
        getters: {},
        actions: {
          load: (request: Promise<number>) =>
            context.runTask(async (task) => {
              contexts.push(task);
              const value = await request;
              return task.commit(() => count.set(value));
            }),
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game),
    request = deferred<number>(),
    pending = store.actions.load(request.promise);
  assert.equal(store.userScoped, false);
  store.reset();
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(contexts[0]!.signal.aborted, true);
  request.resolve(100);
  await nextTick();
  assert.equal(store.state.count(), 1);
  const late = deferred<number>(),
    disposed = store.actions.load(late.promise);
  owner.dispose();
  assert.deepEqual(await disposed, { status: 'cancelled' });
  assert.equal(contexts[1]!.signal.aborted, true);
  late.reject(new Error('late network failure'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(store.state.count(), 1);
});

test('reset continues state restoration and callbacks after cancellation/cleanup errors', async () => {
  let notified = 0;
  const Game = defineStore({
    name: 'reset-errors',
    setup(context) {
      const count = signal(1);
      context.onReset(() => {
        throw new Error('reset listener');
      });
      context.onReset(() => {
        notified++;
      });
      return {
        state: { count },
        getters: {},
        actions: {
          change: () => count.set(9),
          load: (promise: Promise<void>) =>
            context.runTask(async (task) => {
              task.signal.subscribe(() => {
                throw new Error('cancel listener');
              });
              await promise;
              return task.commit(() => count.set(10));
            }),
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game),
    request = deferred<void>(),
    pending = store.actions.load(request.promise);
  store.actions.change();
  assert.throws(
    () => store.reset(),
    (error) =>
      error instanceof StoreError &&
      error.operation === 'reset' &&
      error.cause instanceof AggregateError &&
      error.cause.errors.length === 2,
  );
  assert.equal(store.state.count(), 1);
  assert.equal(notified, 1);
  assert.deepEqual(await pending, { status: 'cancelled' });
  request.resolve();
  await nextTick();
  assert.equal(store.state.count(), 1);
  owner.dispose();
});

test('failed task commits preserve operation sources and a later task can reuse the key', async () => {
  const failure = new Error('commit failed');
  const Game = defineStore({
    name: 'task-errors',
    setup(context) {
      return {
        state: {},
        getters: {},
        actions: {
          fail: () =>
            context.runTask(
              async (task) =>
                task.commit(() => {
                  throw failure;
                }),
              { key: 'work' },
            ),
          retry: () => context.runTask(() => 7, { key: 'work' }),
        },
      };
    },
  });
  const owner = application(),
    store = owner.resolve('stores', Game);
  await assert.rejects(
    store.actions.fail(),
    (error) =>
      error instanceof StoreError &&
      error.operation === 'action:fail' &&
      error.cause instanceof StoreError &&
      error.cause.operation === 'task' &&
      error.cause.cause instanceof StoreError &&
      error.cause.cause.operation === 'commit' &&
      error.cause.cause.cause === failure,
  );
  assert.deepEqual(await store.actions.retry(), { status: 'completed', value: 7 });
  owner.dispose();
});
