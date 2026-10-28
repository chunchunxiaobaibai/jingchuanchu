import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineApplication,
  mountApplication,
  defineComponent,
  definePage,
  RouterOutlet,
  createMemoryHistoryDriver,
  type IdleScheduler,
  type RoutePage,
  type GuardResult,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { defaultIdleScheduler } from '../packages/app/runtime/router/idle.js';
const settle = () => new Promise<void>((done) => setImmediate(done));
function scheduler() {
  const callbacks = new Map<number, () => void>();
  let id = 0;
  const driver: IdleScheduler = {
    schedule(callback) {
      const key = ++id;
      callbacks.set(key, callback);
      return () => {
        callbacks.delete(key);
      };
    },
  };
  return {
    driver,
    callbacks,
    step() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry);
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
}
function host() {
  const document = new Window().document as unknown as Document;
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}
const Root = defineComponent({
  selector: 'idle-app',
  components: [RouterOutlet],
  $template: '<router-outlet></router-outlet>',
});
const Home = definePage({ selector: 'idle-home', $template: '<p>home</p>' });

test('application idle queue uses a finite snapshot, deduplicates targets, serializes imports and skips non-opted/protected pages', async () => {
  const idle = scheduler();
  const loaded: string[] = [];
  let release!: (page: RoutePage) => void,
    guards = 0,
    prepares = 0,
    created = 0;
  const pending = new Promise<RoutePage>((done) => {
    release = done;
  });
  const Lazy = definePage({
    selector: 'idle-lazy',
    $template: '<p>lazy</p>',
    setup() {
      created++;
      return {};
    },
  });
  const targets = ['/first', '/first', '/guard', '/none', '/second'];
  const definition = defineApplication({
    root: Root,
    routes: [
      { path: '/', page: Home },
      {
        path: '/first',
        preload: 'idle',
        loadPage: () => {
          loaded.push('first');
          return pending;
        },
        prepare: () => {
          prepares++;
          return {};
        },
      },
      {
        path: '/guard',
        preload: 'idle',
        guards: [
          (): GuardResult => {
            guards++;
            return { status: 'allow' };
          },
        ],
        loadPage: async () => {
          loaded.push('guard');
          return Lazy;
        },
      },
      {
        path: '/none',
        loadPage: async () => {
          loaded.push('none');
          return Lazy;
        },
      },
      {
        path: '/second',
        preload: 'idle',
        loadPage: async () => {
          loaded.push('second');
          return Lazy;
        },
      },
    ],
    router: {
      history: () => createMemoryHistoryDriver('/'),
      idle: { targets, scheduler: idle.driver },
    },
  });
  targets.push('/second');
  const app = await mountApplication(host(), definition);
  assert.equal(idle.callbacks.size, 1);
  assert.deepEqual(loaded, []);
  idle.step();
  await settle();
  assert.deepEqual(loaded, ['first']);
  assert.equal(idle.callbacks.size, 0);
  release(Lazy);
  await settle();
  assert.equal(idle.callbacks.size, 1);
  idle.step();
  await settle();
  idle.step();
  await settle();
  idle.step();
  await settle();
  assert.deepEqual(loaded, ['first', 'second']);
  assert.equal(idle.callbacks.size, 0);
  assert.equal(guards, 0);
  assert.equal(prepares, 0);
  assert.equal(created, 0);
  assert.equal(app.router.current()!.fullPath, '/');
  assert.equal(app.router.pending(), null);
  app.dispose();
});

test('application disposal cancels queued callbacks and prevents another idle target after a late import', async () => {
  const idle = scheduler();
  let loads = 0,
    release!: (page: RoutePage) => void;
  const pending = new Promise<RoutePage>((done) => {
    release = done;
  });
  const definition = defineApplication({
    root: Root,
    routes: [
      { path: '/', page: Home },
      {
        path: '/one',
        preload: 'idle',
        loadPage: () => {
          loads++;
          return pending;
        },
      },
      {
        path: '/two',
        preload: 'idle',
        loadPage: async () => {
          loads++;
          return Home;
        },
      },
    ],
    router: {
      history: () => createMemoryHistoryDriver('/'),
      idle: { targets: ['/one', '/two'], scheduler: idle.driver },
    },
  });
  const queued = await mountApplication(host(), definition);
  const lateCallback = [...idle.callbacks.values()][0]!;
  queued.dispose();
  assert.equal(idle.callbacks.size, 0);
  lateCallback();
  await settle();
  assert.equal(loads, 0);
  const running = await mountApplication(host(), definition);
  idle.step();
  await settle();
  assert.equal(loads, 1);
  running.dispose();
  release(Home);
  await settle();
  assert.equal(idle.callbacks.size, 0);
  assert.equal(loads, 1);
});

test('default scheduler uses cancellable host idle callbacks and its timer fallback can be cancelled', async () => {
  let callback: (() => void) | undefined,
    cancelled = 0,
    calls = 0;
  const idle = defaultIdleScheduler({
    requestIdleCallback(run) {
      callback = run;
      return 7;
    },
    cancelIdleCallback(handle) {
      cancelled = handle;
    },
  });
  const cancel = idle.schedule(() => {
    calls++;
  });
  cancel();
  assert.equal(cancelled, 7);
  assert.equal(calls, 0);
  assert.ok(callback);
  const fallback = defaultIdleScheduler();
  const stop = fallback.schedule(() => {
    calls++;
  });
  stop();
  await settle();
  assert.equal(calls, 0);
});
