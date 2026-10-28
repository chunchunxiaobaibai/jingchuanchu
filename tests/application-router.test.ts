import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineApplication,
  mountApplication,
  defineComponent,
  definePage,
  RouterOutlet,
  RouteLink,
  createMemoryHistoryDriver,
  defineStore,
  signal,
  nextTick,
  ApplicationError,
  type HistoryDriver,
  type RouteLocation,
  type GuardResult,
  defineService,
  provideService,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

function dom(url = 'https://example.test/game') {
  const window = new Window({ url });
  const document = window.document as unknown as Document;
  const host = document.createElement('app-host');
  document.body.append(host);
  return { host, window };
}

test('shared routed application definitions mount independent routers/Stores and expose a ready initial page', async () => {
  const starts: (RouteLocation | null)[] = [],
    pageIds: string[] = [];
  let histories = 0,
    closed = 0;
  const Game = defineStore({
    name: 'routed-game',
    setup() {
      const count = signal(0);
      return {
        state: { count },
        getters: {},
        actions: { visit: () => count.update((n) => n + 1) },
      };
    },
  });
  const Root = defineComponent({
    selector: 'routed-app',
    components: [RouterOutlet, RouteLink],
    $template: '<route-link to="/other"></route-link><router-outlet></router-outlet>',
    setup(c) {
      starts.push(c.route());
      return { count: c.useStore(Game).state.count };
    },
  });
  const Level = definePage({
    selector: 'level-page',
    $template: '<p>level</p>',
    setup(c) {
      pageIds.push(c.route()!.params.id!);
      c.useStore(Game).actions.visit();
      return {};
    },
  });
  const Other = definePage({ selector: 'other-page', $template: '<p>other</p>' });
  const definition = defineApplication({
    root: Root,
    routes: [
      { name: 'level', path: '/level/:id', page: Level },
      { name: 'other', path: '/other', page: Other },
    ],
    router: {
      history() {
        histories++;
        const history = createMemoryHistoryDriver('/level/one');
        let disposed = false;
        return {
          ...history,
          dispose() {
            if (disposed) return;
            disposed = true;
            closed++;
            history.dispose();
          },
        };
      },
    },
  });
  const firstDom = dom(),
    secondDom = dom();
  const first = await mountApplication(firstDom.host, definition),
    second = await mountApplication(secondDom.host, definition);
  assert.equal(histories, 2);
  assert.notEqual(first.router, second.router);
  assert.deepEqual(starts, [null, null]);
  assert.deepEqual(pageIds, ['one', 'one']);
  assert.equal(first.root.exposed.count(), 1);
  assert.equal(
    (await first.router.push({ name: 'level', params: { id: 'two' } })).status,
    'committed',
  );
  assert.equal(first.root.exposed.count(), 2);
  assert.equal(second.root.exposed.count(), 1);
  firstDom.host
    .querySelector('a')!
    .dispatchEvent(
      new firstDom.window.MouseEvent('click', { button: 0, cancelable: true }) as unknown as Event,
    );
  await new Promise<void>((done) => setImmediate(done));
  await nextTick();
  assert.equal(first.router.current()!.name, 'other');
  assert.ok(firstDom.host.querySelector('other-page'));
  first.dispose();
  first.dispose();
  assert.equal(closed, 1);
  assert.equal(first.state(), 'disposed');
  assert.equal(firstDom.host.childNodes.length, 0);
  assert.equal(second.router.current()!.params.id, 'one');
  second.dispose();
  assert.equal(closed, 2);
});

test('initial rejection, page failure and missing outlets release history and restore the reusable host, with one error notification', async () => {
  const errors: ApplicationError[] = [];
  let mode: 'deny' | 'fail' | 'ready' = 'deny',
    closed = 0;
  const Root = defineComponent({
    selector: 'retry-route-app',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const Page = definePage({
    selector: 'retry-route-page',
    $template: '<p>ready</p>',
    setup() {
      if (mode === 'fail') throw new Error('page failed');
      return {};
    },
  });
  const history = (): HistoryDriver => {
    const driver = createMemoryHistoryDriver('/');
    return {
      ...driver,
      dispose() {
        closed++;
        driver.dispose();
      },
    };
  };
  const definition = defineApplication({
    root: Root,
    routes: [
      {
        path: '/',
        page: Page,
        guards: [(): GuardResult => (mode === 'deny' ? { status: 'deny' } : { status: 'allow' })],
      },
    ],
    router: { history },
    onError: (error) => {
      errors.push(error);
    },
  });
  const { host } = dom();
  host.innerHTML = '<em>original</em>';
  const original = host.firstChild;
  for (const stage of ['deny', 'fail'] as const) {
    mode = stage;
    await assert.rejects(mountApplication(host, definition), ApplicationError);
    assert.equal(host.firstChild, original);
  }
  assert.equal(errors.length, 2);
  assert.equal(closed, 2);
  mode = 'ready';
  const application = await mountApplication(host, definition);
  assert.ok(host.querySelector('retry-route-page'));
  application.dispose();
  assert.equal(host.firstChild, original);
  assert.equal(closed, 3);
  const Missing = defineComponent({
    selector: 'missing-outlet-app',
    $template: '<p>no outlet</p>',
  });
  await assert.rejects(
    mountApplication(
      host,
      defineApplication({
        root: Missing,
        routes: [{ path: '/', page: Page }],
        router: { history },
      }),
    ),
    /registered router-outlet/,
  );
  assert.equal(closed, 4);
  assert.equal(host.firstChild, original);
});

test('default hash and history/base use the injected document window and release it for remount', async () => {
  const Root = defineComponent({
    selector: 'browser-mode-app',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const Page = definePage({ selector: 'browser-mode-page', $template: '<p>ready</p>' });
  const hashDom = dom('https://example.test/game#/home');
  const hashDefinition = defineApplication({ root: Root, routes: [{ path: '/home', page: Page }] });
  const hash = await mountApplication(hashDom.host, hashDefinition);
  assert.equal(hash.router.current()!.fullPath, '/home');
  assert.equal(hash.router.href('/home'), '#/home');
  hash.dispose();
  (await mountApplication(hashDom.host, hashDefinition)).dispose();
  const historyDom = dom('https://example.test/games/home');
  const app = await mountApplication(
    historyDom.host,
    defineApplication({
      root: Root,
      routes: [{ path: '/home', page: Page }],
      router: { mode: 'history', base: '/games' },
    }),
  );
  assert.equal(app.router.href('/home'), '/games/home');
  assert.equal(historyDom.window.location.pathname, '/games/home');
  app.dispose();
});

test('routed teardown stops history before root services and aggregates failures once while releasing the host', async () => {
  const calls: string[] = [],
    errors: ApplicationError[] = [];
  let fail = true;
  const Service = defineService({
    name: 'route-lifetime',
    factory(c) {
      c.own(() => {
        calls.push('service');
        if (fail) throw new Error('service cleanup');
      });
      return {};
    },
  });
  const Root = defineComponent({
    selector: 'exit-route-app',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
    setup(c) {
      c.useService(Service);
      return {};
    },
    onDestroy() {
      calls.push('root');
    },
  });
  const Page = definePage({
    selector: 'exit-route-page',
    $template: '<p>page</p>',
    onDestroy() {
      calls.push('page');
      if (fail) throw new Error('page cleanup');
    },
  });
  const definition = defineApplication({
    root: Root,
    providers: [provideService(Service)],
    routes: [{ path: '/', page: Page }],
    router: {
      history() {
        const history = createMemoryHistoryDriver('/');
        return {
          ...history,
          dispose() {
            history.dispose();
            calls.push('history');
            if (fail) throw new Error('history cleanup');
          },
        };
      },
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  const { host } = dom();
  host.innerHTML = '<em>original</em>';
  const original = host.firstChild;
  const app = await mountApplication(host, definition);
  assert.throws(() => app.dispose(), ApplicationError);
  assert.deepEqual(calls, ['page', 'history', 'root', 'service']);
  assert.equal(errors.length, 1);
  assert.equal(app.state(), 'disposed');
  assert.equal(host.firstChild, original);
  app.dispose();
  fail = false;
  (await mountApplication(host, definition)).dispose();
  assert.equal(host.firstChild, original);
});
