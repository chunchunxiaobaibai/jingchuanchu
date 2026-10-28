import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRouter,
  createMemoryHistoryDriver,
  defineRoutes,
  definePage,
  type RouteRenderer,
  type RouteCandidate,
  type RouteRenderContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Page = definePage({ selector: 'navigation-page', $template: '<p>page</p>' });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function rendering() {
  interface View {
    context: RouteRenderContext;
    disposed: boolean;
  }
  const state: { active: View | null; created: View[]; rolledBack: string[] } = {
    active: null,
    created: [],
    rolledBack: [],
  };
  const renderer: RouteRenderer = {
    create(context) {
      const view = { context, disposed: false };
      state.created.push(view);
      return {
        commit() {
          const previous = state.active;
          state.active = view;
          return () => {
            state.active = previous;
            state.rolledBack.push(context.to.path);
          };
        },
        dispose() {
          view.disposed = true;
          if (state.active === view) state.active = null;
        },
      };
    },
  };
  return { renderer, state };
}

test('navigation runs leave/enter guards, prepares page inputs and computes retained layout depth', async () => {
  const calls: string[] = [],
    port = rendering(),
    history = createMemoryHistoryDriver('/');
  const routes = defineRoutes([
    {
      path: '/',
      page: Page,
      guards: [
        () => {
          calls.push('layout guard');
          return { status: 'allow' };
        },
      ],
      beforeLeave: () => {
        calls.push('layout leave');
        return { status: 'allow' };
      },
      children: [
        {
          name: 'home',
          path: '',
          page: Page,
          beforeLeave: () => {
            calls.push('home leave');
            return { status: 'allow' };
          },
        },
        {
          name: 'play',
          path: 'play/:id',
          page: Page,
          guards: [
            () => {
              calls.push('play guard');
              return { status: 'allow' };
            },
          ],
          beforeLeave: () => {
            calls.push('play leave');
            return { status: 'allow' };
          },
          prepare: (context) => {
            calls.push('prepare');
            return { level: context.params.id };
          },
        },
      ],
    },
  ]);
  const router = createRouter({ routes, history, renderer: port.renderer });
  assert.equal(router.current(), null);
  assert.equal((await router.replace('/')).status, 'committed');
  calls.length = 0;
  const result = await router.push({ name: 'play', params: { id: 2 } });
  assert.equal(result.status, 'committed');
  assert.deepEqual(calls, ['home leave', 'layout guard', 'play guard', 'prepare']);
  assert.equal(port.state.active!.context.reuseDepth, 1);
  assert.deepEqual(port.state.active!.context.views[1]!.inputs, { level: '2' });
  assert.equal(router.current()!.params.id, '2');
  assert.equal(history.read().position, 1);
  assert.equal(router.pending(), null);
  assert.equal('set' in router.current, false);
  calls.length = 0;
  await router.replace({ name: 'play', params: { id: 3 } });
  assert.equal(history.read().position, 1);
  assert.deepEqual(calls, ['play leave', 'layout guard', 'play guard', 'prepare']);
  router.dispose();
  assert.equal(port.state.active, null);
});

test('guard denial avoids loading/preparation and rejected back restores the committed address and position', async () => {
  let locked = true,
    leave = true,
    loaded = 0,
    prepared = 0;
  const port = rendering(),
    history = createMemoryHistoryDriver('/a');
  const routes = defineRoutes([
    { name: 'a', path: '/a', page: Page },
    {
      name: 'b',
      path: '/b',
      loadPage: async () => {
        loaded++;
        return Page;
      },
      guards: [() => (locked ? { status: 'deny', reason: 'locked' } : { status: 'allow' })],
      beforeLeave: () => (leave ? { status: 'allow' } : { status: 'deny', reason: 'unsaved' }),
      prepare: () => {
        prepared++;
        return {};
      },
    },
  ]);
  const router = createRouter({ routes, history, renderer: port.renderer });
  await router.replace('/a');
  assert.equal((await router.push('/b')).status, 'denied');
  assert.equal(loaded, 0);
  assert.equal(prepared, 0);
  assert.equal(port.state.created.length, 1);
  assert.equal(history.read().fullPath, '/a');
  locked = false;
  await router.push('/b');
  assert.equal(loaded, 1);
  leave = false;
  assert.equal((await router.back()).status, 'denied');
  assert.equal(history.read().fullPath, '/b');
  assert.equal(history.read().position, 1);
  assert.equal(router.current()!.path, '/b');
  assert.equal(port.state.active!.context.to.path, '/b');
  leave = true;
  assert.equal((await router.back()).status, 'committed');
  assert.equal(history.read().position, 0);
  assert.equal(router.current()!.path, '/a');
  router.dispose();
});

test('redirects stop the current guard chain and loops fail without changing the committed page', async () => {
  let unreachable = 0;
  const port = rendering(),
    history = createMemoryHistoryDriver('/alias');
  const routes = defineRoutes([
    { path: '/alias', redirect: '/policy' },
    {
      path: '/policy',
      page: Page,
      guards: [
        () => ({ status: 'redirect', target: '/ready' }),
        () => {
          unreachable++;
          return { status: 'allow' };
        },
      ],
    },
    { path: '/ready', page: Page },
    {
      path: '/bad-policy',
      page: Page,
      guards: [
        () =>
          ({
            status: 'redirect',
          }) as unknown as import('@xiaobaibaifqy/jingchuanchu-app/application').GuardResult,
      ],
    },
    { path: '/x', redirect: '/y' },
    { path: '/y', redirect: '/x' },
  ]);
  const router = createRouter({ routes, history, renderer: port.renderer }),
    result = await router.replace('/alias');
  assert.equal(result.status, 'redirected');
  if (result.status === 'redirected') assert.deepEqual(result.redirects, ['/alias', '/policy']);
  assert.equal(unreachable, 0);
  assert.equal(port.state.created.length, 1);
  assert.equal(history.read().fullPath, '/ready');
  assert.equal((await router.push('/bad-policy')).status, 'failed');
  assert.match(router.error()!.message, /requires a target/);
  assert.equal(port.state.created.length, 1);
  assert.equal((await router.push('/x')).status, 'failed');
  assert.match(router.error()!.message, /redirect loop/);
  assert.equal(router.current()!.path, '/ready');
  assert.equal(history.read().fullPath, '/ready');
  router.dispose();
});

test('superseded preparation cancels promptly and late candidates are disposed instead of committed', async () => {
  const wait = deferred<Record<string, unknown>>(),
    late = deferred<RouteCandidate>(),
    port = rendering(),
    history = createMemoryHistoryDriver('/home');
  let signal: import('@xiaobaibaifqy/jingchuanchu-core').CancellationSignal | undefined,
    lateClosed = 0,
    lateCommitted = 0;
  const original = port.renderer.create;
  port.renderer.create = (context) =>
    context.to.path === '/late' ? late.promise : original(context);
  const routes = defineRoutes([
    { path: '/home', page: Page },
    {
      path: '/slow',
      page: Page,
      prepare: (context) => {
        signal = context.signal;
        return wait.promise;
      },
    },
    { path: '/late', page: Page },
    { path: '/fast', page: Page },
  ]);
  const router = createRouter({ routes, history, renderer: port.renderer });
  await router.replace('/home');
  const old = router.push('/slow');
  assert.equal(router.pending()!.to.path, '/slow');
  const fast = router.push('/fast');
  assert.equal((await old).status, 'cancelled');
  assert.equal(signal!.aborted, true);
  assert.equal((await fast).status, 'committed');
  wait.resolve({ value: 'obsolete' });
  await settle();
  assert.equal(
    port.state.created.some((view) => view.context.to.path === '/slow'),
    false,
  );
  const candidate = router.push('/late');
  const newer = router.push('/home');
  assert.equal((await candidate).status, 'cancelled');
  await newer;
  late.resolve({
    commit() {
      lateCommitted++;
      return () => {};
    },
    dispose() {
      lateClosed++;
    },
  });
  await settle();
  assert.equal(lateClosed, 1);
  assert.equal(lateCommitted, 0);
  assert.equal(router.current()!.path, '/home');
  router.dispose();
});

test('URL write failure rolls back the candidate; old-page cleanup failure keeps the new commit', async () => {
  const port = rendering(),
    base = createMemoryHistoryDriver('/one'),
    errors: unknown[] = [];
  let rejectWrite = false;
  const history = {
    ...base,
    push(path: string) {
      if (rejectWrite) throw new Error('URL write failed');
      return base.push(path);
    },
  };
  const create = port.renderer.create;
  port.renderer.create = (context) => {
    const candidate = create(context) as RouteCandidate;
    return {
      commit: () => candidate.commit(),
      dispose() {
        candidate.dispose();
        if (context.to.path === '/one') throw new Error('old page close failed');
      },
    };
  };
  const router = createRouter({
    routes: defineRoutes([
      { path: '/one', page: Page },
      { path: '/two', page: Page },
    ]),
    history,
    renderer: port.renderer,
    onError: (error) => {
      errors.push(error);
    },
  });
  await router.replace('/one');
  rejectWrite = true;
  assert.equal((await router.push('/two')).status, 'failed');
  assert.equal(router.current()!.path, '/one');
  assert.equal(port.state.active!.context.to.path, '/one');
  assert.equal(history.read().fullPath, '/one');
  assert.deepEqual(port.state.rolledBack, ['/two']);
  assert.equal(port.state.created[1]!.disposed, true);
  rejectWrite = false;
  assert.equal((await router.push('/two')).status, 'committed');
  assert.equal(router.current()!.path, '/two');
  assert.equal(history.read().fullPath, '/two');
  assert.equal(port.state.active!.context.to.path, '/two');
  assert.match(router.error()!.message, /old page close failed/);
  assert.equal(router.error()!.source, '/one');
  assert.equal(errors.length, 2);
  router.dispose();
});

test('candidate construction failure preserves the old view and disposal cancels pending work', async () => {
  const port = rendering(),
    wait = deferred<Record<string, unknown>>(),
    history = createMemoryHistoryDriver('/home');
  let signal: import('@xiaobaibaifqy/jingchuanchu-core').CancellationSignal | undefined;
  const create = port.renderer.create;
  port.renderer.create = (context) => {
    if (context.to.path === '/broken') throw new Error('candidate failed');
    return create(context);
  };
  const router = createRouter({
    routes: defineRoutes([
      { path: '/home', page: Page },
      { path: '/broken', page: Page },
      {
        path: '/pending',
        page: Page,
        prepare: (context) => {
          signal = context.signal;
          return wait.promise;
        },
      },
    ]),
    history,
    renderer: port.renderer,
  });
  await router.replace('/home');
  assert.equal((await router.push('/broken')).status, 'failed');
  assert.equal(router.current()!.path, '/home');
  assert.equal(history.read().fullPath, '/home');
  assert.match(router.error()!.message, /candidate failed/);
  const pending = router.push('/pending');
  router.dispose();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(signal!.aborted, true);
  assert.equal(router.pending(), null);
  assert.equal(port.state.active, null);
  wait.resolve({});
  await settle();
  assert.equal((await router.push('/home')).status, 'cancelled');
  router.dispose();
});

test('dispose continues driver cleanup after view cleanup failure and remains idempotent', async () => {
  const port = rendering(),
    history = createMemoryHistoryDriver('/home'),
    create = port.renderer.create;
  port.renderer.create = (context) => {
    const candidate = create(context) as RouteCandidate;
    return {
      commit: () => candidate.commit(),
      dispose() {
        candidate.dispose();
        throw new Error('view exit failed');
      },
    };
  };
  const router = createRouter({
    routes: defineRoutes([{ path: '/home', page: Page }]),
    history,
    renderer: port.renderer,
  });
  await router.replace('/home');
  assert.throws(() => router.dispose(), /view exit failed|cleanup|dispose/);
  assert.equal(port.state.active, null);
  assert.throws(() => history.read(), /disposed/);
  router.dispose();
});

test('a new navigation waits for an in-flight pop restoration without letting the old pop overwrite its URL', async () => {
  let rejectA = false;
  const base = createMemoryHistoryDriver('/a'),
    started = deferred<void>(),
    release = deferred<void>(),
    port = rendering();
  const history = {
    ...base,
    async restore(entry: import('@xiaobaibaifqy/jingchuanchu-app/application').HistoryEntry) {
      started.resolve();
      await release.promise;
      await base.restore(entry);
    },
  };
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/a',
        page: Page,
        guards: [() => (rejectA ? { status: 'deny' } : { status: 'allow' })],
      },
      { path: '/b', page: Page },
      { path: '/c', page: Page },
    ]),
    history,
    renderer: port.renderer,
  });
  await router.replace('/a');
  await router.push('/b');
  rejectA = true;
  const back = router.back();
  await started.promise;
  const next = router.push('/c');
  assert.equal((await back).status, 'cancelled');
  assert.equal(router.current()!.path, '/b');
  assert.equal(port.state.active!.context.to.path, '/b');
  release.resolve();
  assert.equal((await next).status, 'committed');
  assert.equal(router.current()!.path, '/c');
  assert.equal(history.read().fullPath, '/c');
  assert.equal(history.read().position, 2);
  router.dispose();
});

test('invalidation cancels pending preparation, releases the current view without leave veto and keeps the router usable', async () => {
  const waiting = deferred<Record<string, unknown>>();
  const { renderer, state } = rendering();
  const router = createRouter({
    routes: defineRoutes([
      { path: '/', page: Page, beforeLeave: () => ({ status: 'deny' }) },
      { path: '/pending', page: Page, prepare: () => waiting.promise },
      { path: '/public', page: Page },
    ]),
    history: createMemoryHistoryDriver('/'),
    renderer,
  });
  await router.push('/');
  // Leave veto prevents normal movement but must not preserve an invalidated view.
  assert.equal((await router.push('/public')).status, 'denied');
  router.invalidate();
  assert.equal(state.active, null);
  assert.equal(state.created[0]!.disposed, true);
  assert.equal(router.current(), null);
  const pending = router.push('/pending');
  await settle();
  router.invalidate();
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(router.pending(), null);
  waiting.resolve({});
  await settle();
  assert.equal(state.created.length, 1);
  assert.equal((await router.replace('/public')).status, 'committed');
  assert.equal(state.created.length, 2);
  router.dispose();
  router.invalidate();
});
