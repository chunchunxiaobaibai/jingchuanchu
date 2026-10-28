import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRouter,
  createMemoryHistoryDriver,
  defineRoutes,
  definePage,
  type RoutePage,
  type RouteRenderContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Page = definePage({ selector: 'loading-page', $template: '<p>page</p>' });
const settle = () => new Promise<void>((done) => setImmediate(done));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('preload and navigation share one module load without pre-running policy, inputs or page instances', async () => {
  const loading = deferred<RoutePage>(),
    views: RouteRenderContext[] = [];
  let loads = 0,
    guards = 0,
    prepares = 0;
  const loader = () => {
    loads++;
    return loading.promise;
  };
  const history = createMemoryHistoryDriver('/level/one');
  const router = createRouter({
    routes: defineRoutes([
      {
        name: 'level',
        path: '/level/:id',
        loadPage: loader,
        guards: [
          () => {
            guards++;
            return { status: 'allow' };
          },
        ],
        prepare: (c) => {
          prepares++;
          return { id: c.params.id };
        },
      },
      { path: '/alias', loadPage: loader },
    ]),
    history,
    renderer: {
      create(context) {
        views.push(context);
        return { commit: () => () => {}, dispose() {} };
      },
    },
  });
  const first = router.preload({ name: 'level', params: { id: 'one' } }),
    alias = router.preload('/alias');
  await settle();
  assert.equal(loads, 1);
  assert.equal(guards, 0);
  assert.equal(prepares, 0);
  assert.equal(views.length, 0);
  assert.equal(router.current(), null);
  assert.equal(router.pending(), null);
  assert.equal(router.error(), null);
  assert.deepEqual(history.read(), { fullPath: '/level/one', position: 0 });
  const navigation = router.push('/level/one');
  await settle();
  assert.equal(guards, 1);
  assert.equal(loads, 1);
  assert.equal(prepares, 0);
  loading.resolve(Page);
  assert.equal((await first).status, 'loaded');
  assert.equal((await alias).status, 'loaded');
  assert.equal((await navigation).status, 'committed');
  assert.equal((await router.push('/level/two')).status, 'committed');
  assert.equal(loads, 1);
  assert.equal(guards, 2);
  assert.equal(prepares, 2);
  assert.equal(views.length, 2);
  assert.deepEqual(
    views.map((c) => c.views[0]!.inputs),
    [{ id: 'one' }, { id: 'two' }],
  );
  router.dispose();
});

test('failed and invalid module results are not cached, and preload failures do not replace navigation diagnostics', async () => {
  let calls = 0;
  const history = createMemoryHistoryDriver('/');
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/',
        loadPage() {
          calls++;
          if (calls === 1) throw new Error('chunk missing');
          return Promise.resolve(calls === 2 ? ({} as RoutePage) : Page);
        },
      },
    ]),
    history,
    renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
  });
  assert.equal((await router.push('/missing')).status, 'failed');
  const diagnostic = router.error();
  const first = await router.preload('/');
  assert.equal(first.status, 'failed');
  if (first.status === 'failed') assert.match(first.error.message, /chunk missing/);
  assert.equal((await router.preload('/')).status, 'failed');
  assert.equal((await router.preload('/')).status, 'loaded');
  assert.equal(calls, 3);
  assert.equal(router.error(), diagnostic);
  assert.equal(router.current(), null);
  assert.equal((await router.push('/')).status, 'committed');
  assert.equal(calls, 3);
  router.dispose();
});

test('superseded loading cannot commit a stale page, while the shared module remains usable by the newer target', async () => {
  const loading = deferred<RoutePage>();
  let loads = 0;
  const committed: string[] = [];
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/level/:id',
        loadPage: () => {
          loads++;
          return loading.promise;
        },
      },
    ]),
    history: createMemoryHistoryDriver('/level/one'),
    renderer: {
      create: (context) => ({
        commit() {
          committed.push(context.to.fullPath);
          return () => {};
        },
        dispose() {},
      }),
    },
  });
  const old = router.push('/level/one');
  await settle();
  const latest = router.push('/level/two');
  assert.equal((await old).status, 'cancelled');
  await settle();
  assert.equal(loads, 1);
  loading.resolve(Page);
  assert.equal((await latest).status, 'committed');
  assert.deepEqual(committed, ['/level/two']);
  router.dispose();
});

test('redirect preloads skip the whole chain and disposal cancels waiters promptly and consumes late failures', async () => {
  const loading = deferred<RoutePage>();
  let loads = 0,
    views = 0;
  const loader = () => {
    loads++;
    return loading.promise;
  };
  const router = createRouter({
    routes: defineRoutes([
      { path: '/layout', loadPage: loader, children: [{ path: 'redirect', redirect: '/target' }] },
      { path: '/target', loadPage: loader },
    ]),
    history: createMemoryHistoryDriver('/target'),
    renderer: {
      create() {
        views++;
        return { commit: () => () => {}, dispose() {} };
      },
    },
  });
  assert.deepEqual(await router.preload('/layout/redirect'), {
    status: 'skipped',
    reason: 'redirect',
  });
  assert.equal(loads, 0);
  const pending = router.preload('/target');
  await settle();
  router.dispose();
  assert.equal((await pending).status, 'cancelled');
  assert.equal((await router.preload('/target')).status, 'cancelled');
  loading.reject(new Error('late import rejection'));
  await settle();
  assert.equal(views, 0);
  const fresh = createRouter({
    routes: defineRoutes([{ path: '/target', loadPage: loader }]),
    history: createMemoryHistoryDriver('/target'),
    renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
  });
  const cancelledBeforeStart = fresh.preload('/target');
  fresh.dispose();
  assert.equal((await cancelledBeforeStart).status, 'cancelled');
  await settle();
  assert.equal(loads, 1);
});
