import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineComponent,
  definePage,
  defineRoutes,
  mountComponent,
  RouterOutlet,
  createRouter,
  createMemoryHistoryDriver,
  nextTick,
  effect,
  type RouteLocation,
  type ReadSignal,
  type RouteRenderer,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { createDOMRouteRenderer } from '../packages/app/runtime/router/dom-renderer.js';
import { resolveRouteOutlet } from '../packages/app/runtime/router/outlets.js';
import { installRouterContext } from '../packages/app/runtime/router/context.js';

test('page context starts at the candidate target, inherits into children and restores retained layout data after failure', async () => {
  let renderer!: RouteRenderer;
  let rootRoute!: ReadSignal<RouteLocation | null>, layoutRoute!: ReadSignal<RouteLocation | null>;
  const leafRoutes: ReadSignal<RouteLocation | null>[] = [];
  const candidateTargets: string[] = [],
    rootAtSetup: (string | null)[] = [],
    layoutChanges: string[] = [];
  const Child = defineComponent({
    selector: 'route-child',
    $template: '<p>child</p>',
    setup(c) {
      assert.equal(c.route, leafRoutes.at(-1));
      return {};
    },
  });
  const Leaf = definePage({
    selector: 'context-page',
    components: [Child],
    $template: '<route-child></route-child>',
    setup(c) {
      leafRoutes.push(c.route);
      candidateTargets.push(c.route()!.params.id!);
      rootAtSetup.push(rootRoute()?.params.id ?? null);
      assert.equal(c.router, router);
      assert.equal('set' in c.route, false);
      return {};
    },
  });
  const Layout = definePage({
    selector: 'context-layout',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
    setup(c) {
      layoutRoute = c.route;
      effect(() => {
        layoutChanges.push(c.route()!.fullPath);
      }, c.scope);
      return {};
    },
  });
  const Root = defineComponent({
    selector: 'context-root',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
    setup(c) {
      rootRoute = c.route;
      return {};
    },
  });
  const memory = createMemoryHistoryDriver('/a/one');
  let fail = false;
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/',
        page: Layout,
        children: [
          { path: 'a/:id', page: Leaf },
          { path: 'b/:id', page: Leaf },
        ],
      },
    ]),
    history: {
      ...memory,
      push(path) {
        if (fail) throw new Error('URL failed');
        return memory.push(path);
      },
    },
    renderer: { create: (context) => renderer.create(context) },
  });
  const appOwner = new ComponentOwner();
  installRouterContext(appOwner, router);
  const document = new Window().document as unknown as Document;
  const host = document.createElement('main');
  document.body.append(host);
  const root = mountComponent(host, Root, { owner: appOwner });
  renderer = createDOMRouteRenderer(resolveRouteOutlet(root.owner).host, appOwner);
  assert.equal(rootRoute(), null);
  assert.equal((await router.replace('/a/one')).status, 'committed');
  await nextTick();
  const layoutRead = layoutRoute;
  assert.equal((await router.push('/b/two?q=next')).status, 'committed');
  await nextTick();
  assert.equal(layoutRoute, layoutRead);
  assert.equal(layoutRoute()!.params.id, 'two');
  assert.equal(layoutRoute()!.query.q, 'next');
  assert.equal(rootRoute()!.params.id, 'two');
  assert.equal(leafRoutes[0]!()!.params.id, 'one');
  assert.deepEqual(candidateTargets, ['one', 'two']);
  assert.deepEqual(rootAtSetup, [null, 'one']);
  const before = layoutRoute(),
    observed = [...layoutChanges];
  fail = true;
  assert.equal((await router.push('/a/failed')).status, 'failed');
  await nextTick();
  assert.equal(layoutRoute(), before);
  assert.equal(rootRoute()!.params.id, 'two');
  assert.deepEqual(layoutChanges.slice(0, observed.length), observed);
  assert.ok(layoutChanges.every((path) => !path.includes('failed')));
  assert.equal(layoutChanges.at(-1), before!.fullPath);
  router.dispose();
  appOwner.dispose();
  assert.equal(host.childNodes.length, 0);
});

test('standalone components report missing routing context and independent owners receive independent router instances', () => {
  const document = new Window().document as unknown as Document;
  const Standalone = defineComponent({
    selector: 'standalone-context',
    $template: '',
    setup(c) {
      assert.throws(() => c.router, /Missing component context: router/);
      assert.throws(() => c.route, /Missing component context: route/);
      return {};
    },
  });
  mountComponent(document.createElement('div'), Standalone).dispose();
  const Page = definePage({ selector: 'empty-page', $template: '' });
  const routers = [1, 2].map(() =>
    createRouter({
      routes: defineRoutes([{ path: '/', page: Page }]),
      history: createMemoryHistoryDriver('/'),
      renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
    }),
  );
  const actual: unknown[] = [];
  const Root = defineComponent({
    selector: 'bound-context',
    $template: '',
    setup(c) {
      actual.push(c.router);
      return {};
    },
  });
  const owners = routers.map((router) => {
    const owner = new ComponentOwner();
    installRouterContext(owner, router);
    mountComponent(document.createElement('div'), Root, { owner });
    return owner;
  });
  assert.deepEqual(actual, routers);
  owners.forEach((owner) => owner.dispose());
  routers.forEach((router) => router.dispose());
});
