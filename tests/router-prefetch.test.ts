import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  createRouter,
  createMemoryHistoryDriver,
  defineRoutes,
  definePage,
  RouteLink,
  mountComponent,
  nextTick,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { installRouterContext } from '../packages/app/runtime/router/context.js';
const Page = definePage({ selector: 'prefetch-page', $template: '<p>page</p>' });
const settle = () => new Promise<void>((done) => setImmediate(done));

test('automatic preload requires leaf opt-in and skips every protected ancestor without executing guards', async () => {
  const loads: string[] = [];
  let guards = 0,
    prepares = 0,
    created = 0;
  const loader = (label: string) => async () => {
    loads.push(label);
    return Page;
  };
  const router = createRouter({
    routes: defineRoutes([
      { path: '/public', loadPage: loader('public'), preload: 'intent' },
      { path: '/none', loadPage: loader('none') },
      { path: '/idle', loadPage: loader('idle'), preload: 'idle' },
      {
        path: '/guard',
        page: Page,
        guards: [
          () => {
            guards++;
            return { status: 'allow' };
          },
        ],
        children: [
          {
            path: 'child',
            loadPage: loader('guarded'),
            preload: 'intent',
            meta: { access: 'public' },
          },
        ],
      },
      {
        path: '/private',
        page: Page,
        meta: { access: { session: 'required' } },
        children: [
          {
            path: 'child',
            loadPage: loader('private'),
            preload: 'intent',
            meta: { access: 'public' },
            prepare: () => {
              prepares++;
              return {};
            },
          },
        ],
      },
    ]),
    history: createMemoryHistoryDriver('/public'),
    renderer: {
      create() {
        created++;
        return { commit: () => () => {}, dispose() {} };
      },
    },
  });
  assert.equal((await router.preload('/public', { trigger: 'intent' })).status, 'loaded');
  for (const path of ['/none', '/idle'])
    assert.deepEqual(await router.preload(path, { trigger: 'intent' }), {
      status: 'skipped',
      reason: 'policy',
    });
  for (const path of ['/guard/child', '/private/child'])
    assert.deepEqual(await router.preload(path, { trigger: 'intent' }), {
      status: 'skipped',
      reason: 'protected',
    });
  assert.deepEqual(loads, ['public']);
  assert.equal((await router.preload('/idle', { trigger: 'idle' })).status, 'loaded');
  assert.equal((await router.preload('/private/child')).status, 'loaded');
  assert.deepEqual(loads, ['public', 'idle', 'private']);
  assert.equal(guards, 0);
  assert.equal(prepares, 0);
  assert.equal(created, 0);
  assert.equal(router.current(), null);
  assert.equal(router.pending(), null);
  assert.equal(router.error(), null);
  router.dispose();
});

test('RouteLink focus and pointer intent deduplicate modules, skip non-navigation targets and stop after disposal', async () => {
  let release!: (page: typeof Page) => void;
  const loading = new Promise<typeof Page>((done) => {
    release = done;
  });
  let loads = 0,
    later = 0,
    guards = 0;
  const router = createRouter({
    routes: defineRoutes([
      {
        path: '/intent',
        loadPage: () => {
          loads++;
          return loading;
        },
        preload: 'intent',
      },
      {
        path: '/later',
        loadPage: async () => {
          later++;
          return Page;
        },
        preload: 'intent',
      },
      {
        path: '/protected',
        loadPage: async () => {
          throw new Error('must not load');
        },
        preload: 'intent',
        guards: [
          () => {
            guards++;
            return { status: 'allow' };
          },
        ],
      },
    ]),
    history: createMemoryHistoryDriver('/intent'),
    renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
  });
  const owner = new ComponentOwner();
  installRouterContext(owner, router);
  const window = new Window(),
    document = window.document as unknown as Document;
  const host = document.createElement('div');
  const link = mountComponent(host, RouteLink, { owner, inputs: { to: '/intent' } });
  const anchor = host.querySelector('a')!;
  const intent = () => {
    anchor.dispatchEvent(new window.Event('focus') as unknown as Event);
    anchor.dispatchEvent(new window.Event('pointerenter') as unknown as Event);
  };
  intent();
  await settle();
  assert.equal(loads, 1);
  assert.equal(router.current(), null);
  assert.equal(router.pending(), null);
  release(Page);
  await settle();
  intent();
  await settle();
  assert.equal(loads, 1);
  link.setInputs({ to: '/protected' });
  await nextTick();
  intent();
  await settle();
  assert.equal(guards, 0);
  assert.equal(router.error(), null);
  link.setInputs({ to: '/later', download: '' });
  await nextTick();
  intent();
  await settle();
  assert.equal(later, 0);
  link.setInputs({ download: null, target: '_blank' });
  await nextTick();
  intent();
  await settle();
  assert.equal(later, 0);
  link.setInputs({ target: '_self' });
  await nextTick();
  link.dispose();
  intent();
  await settle();
  assert.equal(later, 0);
  router.dispose();
  owner.dispose();
});
