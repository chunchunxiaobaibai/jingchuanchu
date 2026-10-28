import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  definePage,
  input,
  defineRoutes,
  createRouter,
  createMemoryHistoryDriver,
  nextTick,
  RouterOutlet,
  type RouteRenderContext,
  type HistoryDriver,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { createDOMRouteRenderer } from '../packages/app/runtime/router/dom-renderer.js';

function dom() {
  const document = new Window().document as unknown as Document;
  const outlet = document.createElement('router-outlet');
  const original = document.createElement('em');
  original.textContent = 'original';
  outlet.append(original);
  document.body.append(outlet);
  const owner = new ComponentOwner();
  return { outlet, original, owner, renderer: createDOMRouteRenderer(outlet, owner) };
}

test('DOM navigation retains a layout and releases replaced leaves, then its owner restores the outlet', async () => {
  const { outlet, owner, original, renderer } = dom();
  const calls: string[] = [];
  let layoutMounts = 0;
  const Layout = definePage({
    selector: 'layout-page',
    components: [RouterOutlet],
    $template: '<h1>layout</h1><router-outlet></router-outlet>',
    setup(c) {
      layoutMounts++;
      c.own(() => calls.push('layout:cleanup'));
      return {};
    },
  });
  const First = definePage({
    selector: 'first-page',
    $template: '<button>first</button>',
    setup(c) {
      c.own(() => calls.push('first:cleanup'));
      return {};
    },
  });
  const Second = definePage({
    selector: 'second-page',
    $template: '<p>second</p>',
    inputs: { label: input<string>({ required: true }) },
    setup(c) {
      assert.equal(c.inputs.label(), 'prepared');
      c.own(() => calls.push('second:cleanup'));
      return {};
    },
  });
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/',
        page: Layout,
        children: [
          { path: 'first', page: First },
          { path: 'second', page: Second, prepare: () => ({ label: 'prepared' }) },
        ],
      },
    ]),
    history: createMemoryHistoryDriver('/first'),
    renderer,
  });
  assert.equal((await router.replace('/first')).status, 'committed');
  const layout = outlet.querySelector('layout-page');
  const first = outlet.querySelector('first-page')!;
  assert.equal((await router.push('/second')).status, 'committed');
  assert.equal(outlet.querySelector('layout-page'), layout);
  assert.equal(layoutMounts, 1);
  assert.equal(first.isConnected, false);
  assert.deepEqual(calls, ['first:cleanup']);
  assert.equal((await router.push('/first')).status, 'committed');
  assert.equal(outlet.querySelector('layout-page'), layout);
  assert.equal(layoutMounts, 1);
  owner.dispose();
  assert.deepEqual(calls, ['first:cleanup', 'second:cleanup', 'first:cleanup', 'layout:cleanup']);
  assert.equal(outlet.firstChild, original);
  router.dispose();
  renderer.dispose();
});

test('history write failure restores the same live DOM and candidate cleanup leaves retained layouts alive', async () => {
  const { outlet, owner, renderer } = dom();
  let destroyed = 0,
    clicks = 0;
  const Layout = definePage({
    selector: 'rollback-layout',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const First = definePage({
    selector: 'rollback-first',
    $template: '<button ref="go">first</button>',
    onMount(c) {
      c.on('go', 'click', () => {
        clicks++;
      });
    },
  });
  const Second = definePage({
    selector: 'rollback-second',
    $template: '<p>second</p>',
    onDestroy() {
      destroyed++;
    },
  });
  const memory = createMemoryHistoryDriver('/first');
  const history: HistoryDriver = {
    ...memory,
    push() {
      throw new Error('URL unavailable');
    },
  };
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/',
        page: Layout,
        children: [
          { path: 'first', page: First },
          { path: 'second', page: Second },
        ],
      },
    ]),
    history,
    renderer,
  });
  await router.replace('/first');
  const layout = outlet.firstChild;
  const first = outlet.querySelector('button')!;
  assert.equal((await router.push('/second')).status, 'failed');
  assert.equal(outlet.firstChild, layout);
  assert.equal(outlet.querySelector('button'), first);
  first.dispatchEvent(new first.ownerDocument.defaultView!.Event('click'));
  assert.equal(clicks, 1);
  assert.equal(destroyed, 1);
  assert.equal(router.current()!.fullPath, '/first');
  assert.equal(memory.read().fullPath, '/first');
  router.dispose();
  owner.dispose();
});

test('DOM commit failure restores old nodes, while failure in old-page destruction keeps the new committed page', async () => {
  const { outlet, owner, renderer } = dom();
  const errors: unknown[] = [];
  const Old = definePage({
    selector: 'destroy-error-page',
    $template: '<p>old</p>',
    onDestroy() {
      throw new Error('old cleanup failed');
    },
  });
  const Next = definePage({ selector: 'next-page', $template: '<p>next</p>' });
  const router = createRouter({
    routes: defineRoutes([
      { path: '/', page: Old },
      { path: '/next', page: Next },
    ]),
    history: createMemoryHistoryDriver('/'),
    renderer,
    onError: (error) => {
      errors.push(error);
    },
  });
  await router.replace('/');
  const live = outlet.firstChild;
  const replace = outlet.replaceChildren.bind(outlet);
  let failOnce = true;
  outlet.replaceChildren = (...nodes) => {
    replace(...nodes);
    if (failOnce) {
      failOnce = false;
      throw new Error('DOM write failed after mutation');
    }
  };
  assert.equal((await router.push('/next')).status, 'failed');
  assert.equal(outlet.firstChild, live);
  assert.equal(router.current()!.fullPath, '/');
  assert.equal((await router.push('/next')).status, 'committed');
  assert.equal(router.current()!.fullPath, '/next');
  assert.equal(outlet.querySelector('next-page')!.textContent, 'next');
  assert.equal(errors.length, 2);
  router.dispose();
  owner.dispose();
});

test('missing nested outlets and invalid prepare inputs reclaim all constructed resources without changing the live page', async () => {
  const { outlet, owner, renderer } = dom();
  let closed = 0;
  const Good = definePage({ selector: 'good-page', $template: '<p>good</p>' });
  const BadLayout = definePage({
    selector: 'bad-layout',
    $template: '<p>no outlet</p>',
    setup(c) {
      c.own(() => {
        closed++;
      });
      return {};
    },
  });
  const Child = definePage({
    selector: 'required-page',
    inputs: { id: input<string>({ required: true }) },
    $template: '<p>child</p>',
  });
  const router = createRouter({
    routes: defineRoutes([
      { path: '/', page: Good },
      { path: '/bad', page: BadLayout, children: [{ path: 'child', page: Good }] },
      { path: '/missing', page: Child },
      { path: '/unknown', page: Good, prepare: () => ({ unknown: true }) },
    ]),
    history: createMemoryHistoryDriver('/'),
    renderer,
  });
  await router.replace('/');
  const live = outlet.firstChild;
  for (const path of ['/bad/child', '/missing', '/unknown']) {
    assert.equal((await router.push(path)).status, 'failed');
    assert.equal(outlet.firstChild, live);
  }
  assert.equal(closed, 1);
  assert.equal(owner.children.size, 1);
  router.dispose();
  assert.equal(owner.children.size, 0);
  owner.dispose();
});

test('abandoned and stale detached candidates cannot overwrite a newer committed candidate', () => {
  const { outlet, owner, original, renderer } = dom();
  let destroyed = 0;
  const Page = definePage({
    selector: 'candidate-page',
    $template: '<p>candidate</p>',
    onDestroy() {
      destroyed++;
    },
  });
  const record = defineRoutes([{ path: '/', page: Page }])[0]!;
  const location = {
    name: undefined,
    path: '/',
    fullPath: '/',
    params: {},
    query: {},
    hash: '',
    matched: [],
    meta: {},
  };
  const context: RouteRenderContext = {
    from: null,
    to: location,
    params: {},
    query: {},
    hash: '',
    signal: new Cancellation(),
    views: [{ record, page: Page, inputs: {} }],
    reuseDepth: 0,
  };
  const stale = renderer.create(context);
  const winner = renderer.create(context);
  // This backend is synchronous; its interface also accepts async renderers.
  assert.ok('commit' in stale && 'commit' in winner);
  assert.equal(outlet.firstChild, original);
  winner.commit();
  assert.throws(() => stale.commit(), /no longer available/);
  stale.dispose();
  assert.equal(destroyed, 1);
  assert.equal(outlet.querySelectorAll('candidate-page').length, 1);
  winner.dispose();
  winner.dispose();
  assert.equal(destroyed, 2);
  assert.equal(outlet.firstChild, original);
  owner.dispose();
});

test('retained layout inputs update only at commit and roll back on DOM or URL failure, including removed defaults', async () => {
  const { outlet, owner, renderer } = dom();
  let mounts = 0,
    defaults = 0,
    failURL = false;
  let readTitle!: () => string, readTag!: () => string;
  let readSettings!: () => Readonly<{ mode: string }>;
  const changes: string[] = [];
  const Layout = definePage({
    selector: 'input-layout',
    components: [RouterOutlet],
    inputs: {
      title: input<string>({ required: true }),
      tag: input<string>({ default: () => `default-${++defaults}` }),
      settings: input<{ mode: string }>({ required: true }),
    },
    $template: '<router-outlet></router-outlet>',
    setup(c) {
      mounts++;
      readTitle = c.inputs.title;
      readTag = c.inputs.tag;
      readSettings = c.inputs.settings;
      return {};
    },
    onInputsChanged(c) {
      changes.push(`${c.inputs.title()}:${c.inputs.tag()}`);
    },
  });
  const Leaf = definePage({ selector: 'input-leaf', $template: '<p>leaf</p>' });
  const memory = createMemoryHistoryDriver('/a?title=first&extra=custom');
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/',
        page: Layout,
        prepare: ({ query }) => ({
          ...(query.missing ? {} : { title: query.title ?? 'fallback' }),
          ...(query.extra ? { tag: query.extra } : {}),
          ...(query.bad ? { unknown: true } : {}),
          settings: { mode: String(query.title ?? 'fallback') },
        }),
        children: [
          { path: 'a', page: Leaf },
          { path: 'b', page: Leaf },
        ],
      },
    ]),
    history: {
      ...memory,
      push(path) {
        if (failURL) throw new Error('URL failed');
        return memory.push(path);
      },
    },
    renderer,
  });
  await router.replace(memory.read().fullPath);
  const layout = outlet.firstChild;
  assert.equal(readTag(), 'custom');
  assert.equal((await router.push('/b?title=second&extra=next')).status, 'committed');
  await nextTick();
  assert.equal(outlet.firstChild, layout);
  assert.equal(readTitle(), 'second');
  assert.equal(readTag(), 'next');
  assert.equal((await router.push('/a?title=third')).status, 'committed');
  await nextTick();
  assert.equal(readTag(), 'default-1');
  const beforeFailures = [...changes];
  const previousSettings = readSettings();
  failURL = true;
  assert.equal((await router.push('/b?title=failed&extra=bad')).status, 'failed');
  failURL = false;
  const nested = outlet.querySelector('router-outlet')!;
  const replace = nested.replaceChildren.bind(nested);
  let failDOM = true;
  nested.replaceChildren = (...nodes) => {
    replace(...nodes);
    if (failDOM) {
      failDOM = false;
      throw new Error('DOM failed');
    }
  };
  assert.equal((await router.push('/b?title=failed-dom&extra=bad')).status, 'failed');
  for (const path of ['/b?missing=1', '/b?title=x&bad=1'])
    assert.equal((await router.push(path)).status, 'failed');
  await nextTick();
  assert.equal(readTitle(), 'third');
  assert.equal(readTag(), 'default-1');
  assert.equal(readSettings(), previousSettings);
  assert.deepEqual(changes, beforeFailures);
  assert.equal(outlet.firstChild, layout);
  assert.equal((await router.push('/b?title=fifth&extra=last')).status, 'committed');
  assert.equal((await router.push('/a?title=sixth')).status, 'committed');
  await nextTick();
  assert.equal(readTitle(), 'sixth');
  assert.equal(readTag(), 'default-2');
  assert.equal(mounts, 1);
  router.dispose();
  owner.dispose();
});
