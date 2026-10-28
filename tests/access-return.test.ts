import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAccessReturnTarget,
  AccessError,
  createRouteMatcher,
  definePage,
  defineRoutes,
  createRouter,
  createMemoryHistoryDriver,
  type RouteTarget,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Page = definePage({ selector: 'return-page', $template: '<p>page</p>' });
const routes = defineRoutes([
  { name: 'home', path: '/', page: Page, meta: { access: 'public' } },
  { name: 'login', path: '/login', page: Page, meta: { access: 'public' } },
  { name: 'play', path: '/play/:id', page: Page, meta: { access: { session: 'required' } } },
  { name: 'redirect', path: '/redirect', redirect: '/login' },
  {
    path: '/layout',
    page: Page,
    children: [{ name: 'child', path: 'child', page: Page, meta: { access: 'public' } }],
  },
]);
const matcher = createRouteMatcher(routes);
const options = {
  resolve: matcher.resolve,
  login: { name: 'login' },
  fallback: { name: 'home' },
} as const;

test('return paths preserve internal route params/query/hash without double decoding', () => {
  const query = matcher.resolve('/login?returnTo=%2Fplay%2Fa%252Fb%3Ftag%3Done%26tag%3Dtwo%23hint');
  const target = resolveAccessReturnTarget(query.query.returnTo, options);
  assert.equal(target, '/play/a%2Fb?tag=one&tag=two#hint');
  assert.equal(matcher.resolve(target).params.id, 'a/b');
  assert.equal(
    resolveAccessReturnTarget('/play/one/?mode=fast#ready', options),
    '/play/one?mode=fast#ready',
  );
});

test('external, malformed, ambiguous, missing, login and redirect return paths use the configured public fallback', () => {
  for (const value of [
    undefined,
    null,
    ['/', '/play/one'],
    { name: 'play', params: { id: 'one' } },
    '',
    'https://outside.example',
    '//outside.example',
    'javascript:alert(1)',
    '%2Fplay%2Fone',
    '/play/%ZZ',
    '/play/%2E%2E',
    '/play/a\\b',
    '/play//one',
    '/absent',
    '/login',
    '/login?returnTo=%2Fplay%2Fone#retry',
    '/redirect',
  ])
    assert.equal(resolveAccessReturnTarget(value, options), '/', String(value));
  assert.equal(
    resolveAccessReturnTarget('/absent', { ...options, fallback: '/?welcome=yes#start' }),
    '/?welcome=yes#start',
  );
});

test('invalid or recursive fallback configuration reports a configuration error', () => {
  for (const fallback of [
    '/login',
    '/login?x=1',
    '/redirect',
    '/play/one',
    '/layout/child',
    '/absent',
    'https://outside.example',
  ])
    assert.throws(
      () => resolveAccessReturnTarget('/play/one', { ...options, fallback }),
      (error) => error instanceof AccessError && error.operation === 'return-target-config',
    );
  assert.throws(
    () => resolveAccessReturnTarget('/play/one', { ...options, login: '/play/one' }),
    AccessError,
  );
});

test('a resolved return target still passes through the router guard before preparing a page', async () => {
  let preparations = 0;
  const checkedRoutes = defineRoutes([
    ...routes,
    {
      name: 'private',
      path: '/private',
      page: Page,
      meta: { access: { session: 'required' } },
      prepare() {
        preparations++;
        return {};
      },
    },
  ]);
  const router = createRouter({
    routes: checkedRoutes,
    history: createMemoryHistoryDriver('/'),
    guards: [
      (context) =>
        context.to.path === '/private'
          ? { status: 'deny', reason: 'forbidden' }
          : { status: 'allow' },
    ],
    renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
  });
  const target = resolveAccessReturnTarget('/private', {
    resolve: router.resolve,
    login: '/login',
    fallback: '/',
  });
  assert.equal(target, '/private');
  assert.equal((await router.push(target)).status, 'denied');
  assert.equal(preparations, 0);
  router.dispose();
});

// Named configuration targets preserve the route's parameter contract.
function typedContract() {
  const target: RouteTarget<typeof routes> = { name: 'play', params: { id: 'one' } };
  void target;
  // @ts-expect-error named targets require their declared params
  resolveAccessReturnTarget('/', { ...options, fallback: { name: 'play' } });
}
void typedContract;
