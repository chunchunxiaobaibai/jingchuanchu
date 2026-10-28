import assert from 'node:assert/strict';
import test from 'node:test';
import {
  definePage,
  defineRoutes,
  createRouteMatcher,
  createMemoryHistoryDriver,
  RouteError,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Page = definePage({ selector: 'route-page', $template: '<p>page</p>' });

test('matching prioritizes static segments and nested index pages while preserving inherited params and metadata', () => {
  const routes = defineRoutes([
    {
      path: '/',
      page: Page,
      meta: { layout: true, theme: 'base' },
      children: [
        { name: 'home', path: '', page: Page },
        { name: 'play', path: 'play/:levelId', page: Page, meta: { theme: 'game' } },
        { name: 'settings', path: 'play/settings', page: Page },
      ],
    },
    {
      name: 'chapter',
      path: '/chapter/:chapterId',
      page: Page,
      children: [{ name: 'detail', path: 'level/:levelId', page: Page }],
    },
    { name: 'missing', path: '/*rest', page: Page },
  ]);
  const matcher = createRouteMatcher(routes),
    home = matcher.resolve('/');
  assert.equal(home.name, 'home');
  assert.equal(home.matched.length, 2);
  assert.equal(matcher.resolve('/play/settings').name, 'settings');
  const play = matcher.resolve('/play/one%2Ftwo/?tag=a&mode=fast&tag=b#hint%20one');
  assert.equal(play.params.levelId, 'one/two');
  assert.deepEqual({ ...play.query }, { tag: ['a', 'b'], mode: 'fast' });
  assert.equal(play.hash, '#hint one');
  assert.equal(play.path, '/play/one%2Ftwo');
  assert.deepEqual({ ...play.meta }, { layout: true, theme: 'game' });
  assert.equal(Object.isFrozen(play), true);
  assert.equal(signal(play)().matched[1]!.path, 'play/:levelId');
  assert.equal(Object.isFrozen(play.query.tag), true);
  const nested = matcher.resolve({
    name: 'detail',
    params: { chapterId: 'c1', levelId: 2 },
    query: { debug: false, omit: null },
    hash: 'notes',
  });
  assert.equal(nested.fullPath, '/chapter/c1/level/2?debug=false#notes');
  assert.deepEqual({ ...nested.params }, { chapterId: 'c1', levelId: '2' });
  assert.equal(nested.matched.length, 2);
  assert.equal(matcher.resolve('/unknown/two').params.rest, 'unknown/two');
  assert.throws(() => matcher.resolve({ name: 'missing', params: { rest: '' } }), /shadowed/);
});

test('named targets encode data and diagnose missing/extra parameters, shadowing and unsafe URLs', () => {
  const matcher = createRouteMatcher(
    defineRoutes([
      { name: 'play', path: '/play/:id', page: Page },
      { name: 'settings', path: '/play/settings', page: Page },
    ]),
  );
  assert.equal(
    matcher.resolve({ name: 'play', params: { id: 'a/b' }, query: { q: 'a & b', tag: [1, true] } })
      .fullPath,
    '/play/a%2Fb?q=a+%26+b&tag=1&tag=true',
  );
  for (const target of [
    'https://example.com',
    '//example.com',
    '/play/%ZZ',
    '/play/%2E%2E',
    '/play/a\\b',
    '/play//a',
    '/play/a?x=%ZZ',
    '/play/a#%ZZ',
  ])
    assert.throws(() => matcher.resolve(target), RouteError);
  assert.equal(matcher.match('/none'), null);
  const dynamic =
    matcher as unknown as import('@xiaobaibaifqy/jingchuanchu-app/application').RouteMatcher<
      readonly import('@xiaobaibaifqy/jingchuanchu-app/application').RouteDefinition[]
    >;
  assert.throws(() => dynamic.resolve({ name: 'play' }), /Missing parameter: id/);
  assert.throws(
    () => dynamic.resolve({ name: 'play', params: { id: 'one', typo: 'two' } }),
    /Unknown parameter: typo/,
  );
  assert.throws(() => matcher.resolve({ name: 'play', params: { id: 'settings' } }), /shadowed/);
  assert.throws(() => dynamic.resolve({ name: 'not-declared' }), /Unknown route name/);
});

test('route definitions diagnose duplicate names/patterns and invalid nesting without executing loaders or navigation hooks', () => {
  assert.throws(
    () =>
      defineRoutes([
        { name: 'same', path: '/one', page: Page },
        { name: 'same', path: '/two', page: Page },
      ]),
    /Duplicate route name/,
  );
  assert.throws(
    () =>
      defineRoutes([
        { path: '/:one', page: Page },
        { path: '/:two', page: Page },
      ]),
    /Conflicting route match pattern/,
  );
  assert.throws(() => defineRoutes([{ path: '/one/*rest/two', page: Page }]), /final segment/);
  assert.throws(
    () => defineRoutes([{ path: '/:id', page: Page, children: [{ path: ':id', page: Page }] }]),
    /Duplicate inherited parameter/,
  );
  assert.throws(
    () => defineRoutes([{ path: '/one', page: Page, children: [{ path: '/two', page: Page }] }]),
    /child paths must be relative/,
  );
  assert.throws(() => defineRoutes([{ path: '/one//', page: Page }]), /Empty path segments/);
  const cycle: import('@xiaobaibaifqy/jingchuanchu-app/application').RouteDefinition[] = [];
  cycle.push({ path: '', page: Page, children: cycle });
  assert.throws(
    () => defineRoutes([{ path: '/', page: Page, children: cycle }]),
    /Circular route children/,
  );
  let loaded = 0,
    prepared = 0,
    guarded = 0;
  const routes = defineRoutes([
    {
      name: 'lazy',
      path: '/lazy',
      loadPage: async () => {
        loaded++;
        return Page;
      },
      prepare: () => {
        prepared++;
        return {};
      },
      guards: [
        () => {
          guarded++;
          return { status: 'allow' };
        },
      ],
    },
    { name: 'alias', path: '/alias', redirect: '/lazy' },
  ]);
  assert.equal(createRouteMatcher(routes).resolve('/lazy').name, 'lazy');
  assert.equal(createRouteMatcher(routes).resolve('/alias').matched.at(-1)!.redirect, '/lazy');
  assert.equal(loaded, 0);
  assert.equal(prepared, 0);
  assert.equal(guarded, 0);
});

test('injected memory history supports silent push/replace, pop and restoration of a rejected destination', async () => {
  const history = createMemoryHistoryDriver('/'),
    changes: string[] = [];
  const stop = history.listen((entry) => changes.push(entry.fullPath));
  const committed = history.push('/play/one');
  history.push('/settings');
  assert.deepEqual(changes, []);
  await history.go(-2);
  assert.equal(history.read().fullPath, '/');
  assert.deepEqual(changes, ['/']);
  await history.restore(committed);
  assert.equal(history.read().fullPath, '/play/one');
  assert.deepEqual(changes, ['/']);
  history.replace('/play/two');
  assert.equal(history.read().position, 1);
  await history.go(1);
  assert.equal(history.read().fullPath, '/settings');
  await history.go(-2);
  history.push('/branch');
  await assert.rejects(history.restore(committed), /no longer available/);
  assert.equal(history.read().fullPath, '/branch');
  const before = history.read();
  assert.throws(() => history.push('//external'), /internal absolute path/);
  assert.equal(history.read(), before);
  assert.equal(await history.go(5), null);
  stop();
  await history.go(-1);
  assert.deepEqual(changes, ['/', '/settings', '/']);
  history.dispose();
  history.dispose();
  assert.throws(() => history.read(), /disposed/);
  await assert.rejects(history.go(-1), /disposed/);
});
