import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  AuthService,
  AccessService,
  createAccessGuard,
  bindAccessRouter,
  defineService,
  provideService,
  defineComponent,
  definePage,
  defineRoutes,
  defineApplication,
  mountApplication,
  RouterOutlet,
  createMemoryHistoryDriver,
  type AuthProvider,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
type User = { id: string; permissions: 'edit'[] };

function fixture(
  options: {
    anonymous?: (returnTo: string) => string;
    restore?: AuthProvider<string, User>['restore'];
    prepare?: () => Promise<Record<string, unknown>>;
    beforeLoad?: () => Promise<void>;
  } = {},
) {
  let restored = 0,
    loaded = 0,
    prepared = 0,
    mounted = 0,
    released = 0,
    factories = 0;
  const Account = defineService({
    name: 'account',
    factory(context) {
      return new AuthService({
        scope: context.scope,
        provider: {
          restore(signal) {
            restored++;
            return options.restore?.(signal) ?? Promise.resolve(null);
          },
          async login(id: string) {
            return { id, permissions: id === 'editor' ? ['edit'] : [] };
          },
          async logout() {},
          decode(value) {
            if (value === null) return { status: 'anonymous' };
            const user = value as User;
            return {
              status: 'authenticated',
              user: { id: user.id, permissions: user.permissions },
            };
          },
        },
      });
    },
  });
  const Access = defineService({
    name: 'access',
    factory(context) {
      return new AccessService({
        auth: context.useService(Account),
        keys: ['edit'] as const,
        permissions: (user) => user.permissions,
      });
    },
  });
  const Public = definePage({ selector: 'public-page', $template: '<p>public</p>' });
  const Private = definePage({
    selector: 'private-page',
    $template: '<p>private</p>',
    setup(context) {
      mounted++;
      context.own(() => {
        released++;
      });
      return {};
    },
  });
  const Root = defineComponent({
    selector: 'access-shell',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
    setup(context) {
      const auth = context.useService(Account);
      bindAccessRouter({ auth, router: context.router, scope: context.scope });
      return { auth };
    },
  });
  const routes = defineRoutes([
    { name: 'home', path: '/', page: Public, meta: { access: 'public' } },
    { name: 'login', path: '/login', page: Public, meta: { access: 'public' } },
    { name: 'forbidden', path: '/forbidden', page: Public, meta: { access: 'public' } },
    { name: 'missing', path: '/missing', page: Private },
    {
      name: 'broken',
      path: '/broken',
      page: Private,
      meta: { access: { session: 'required', all: ['unknown'] } },
    },
    {
      name: 'edit',
      path: '/edit',
      meta: { access: { session: 'required', all: ['edit'] } },
      loadPage: async () => {
        loaded++;
        await options.beforeLoad?.();
        return Private;
      },
      prepare() {
        prepared++;
        return options.prepare?.() ?? {};
      },
      children: [{ name: 'detail', path: 'detail', page: Public, meta: { access: 'public' } }],
    },
  ]);
  const definition = defineApplication({
    root: Root,
    routes,
    providers: [provideService(Account), provideService(Access)],
    router: {
      history: () => createMemoryHistoryDriver('/'),
      guards(context) {
        factories++;
        return [
          createAccessGuard({
            access: context.useService(Access),
            resolve: context.resolve,
            anonymous:
              options.anonymous ??
              ((returnTo) => '/login?returnTo=' + encodeURIComponent(returnTo)),
            forbidden: '/forbidden',
          }),
        ];
      },
    },
  });
  const document = new Window().document as unknown as Document;
  const host = document.createElement('div');
  return {
    host,
    mount: () => mountApplication(host, definition),
    counts: () => ({ restored, loaded, prepared, mounted, released, factories }),
  };
}

test('application guards accumulate matched policies before loading/preparing/mounting; all navigation paths share checks', async () => {
  const f = fixture(),
    app = await f.mount();
  assert.deepEqual(f.counts(), {
    restored: 0,
    loaded: 0,
    prepared: 0,
    mounted: 0,
    released: 0,
    factories: 1,
  });
  assert.deepEqual(await app.router.preload('/edit', { trigger: 'intent' }), {
    status: 'skipped',
    reason: 'protected',
  });
  assert.equal((await app.router.push('/missing')).status, 'denied');
  assert.equal((await app.router.push('/broken')).status, 'denied');
  assert.equal(f.counts().restored, 0);
  assert.equal((await app.router.push('/edit/detail?q=x')).status, 'redirected');
  assert.equal(app.router.current()?.fullPath, '/login?returnTo=%2Fedit%2Fdetail%3Fq%3Dx');
  assert.equal(f.counts().loaded, 0);
  assert.equal(f.counts().prepared, 0);
  assert.equal(f.counts().mounted, 0);
  await app.root.exposed.auth.login('player');
  assert.equal((await app.router.replace('/edit/detail')).status, 'redirected');
  assert.equal(app.router.current()?.path, '/forbidden');
  await app.root.exposed.auth.login('editor');
  assert.equal((await app.router.push({ name: 'edit' })).status, 'committed');
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.counts().mounted, 1);
  await app.router.push('/');
  await app.root.exposed.auth.logout();
  assert.equal((await app.router.back()).status, 'redirected');
  assert.equal(app.router.current()?.path, '/login');
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.counts().factories, 1);
  app.dispose();
});

test('access redirect targets must resolve to different explicit public application routes', async () => {
  for (const target of [
    'https://outside.example',
    '//outside.example',
    '/edit',
    '/missing',
    '/absent',
  ]) {
    const f = fixture({ anonymous: () => target }),
      app = await f.mount();
    const result = await app.router.push('/edit');
    assert.equal(result.status, 'denied', target);
    assert.equal(app.router.current()?.path, '/');
    assert.equal(f.counts().loaded, 0);
    app.dispose();
  }
});

test('superseded navigation settles without cancelling shared recovery or creating the refused page', async () => {
  let finish!: (value: unknown) => void;
  const f = fixture({
      restore: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
    app = await f.mount();
  const pending = app.router.push('/edit');
  const session = app.root.exposed.auth.ensureSession();
  assert.equal((await app.router.push('/')).status, 'committed');
  assert.equal((await pending).status, 'cancelled');
  assert.equal(app.root.exposed.auth.session().status, 'restoring');
  finish({ id: 'editor', permissions: ['edit'] });
  assert.equal((await session).status, 'authenticated');
  assert.equal(f.counts().loaded, 0);
  assert.equal(f.counts().prepared, 0);
  app.dispose();
});

test('guard factory failure reclaims owned resources and the created history driver', async () => {
  const document = new Window().document as unknown as Document;
  const host = document.createElement('div');
  host.innerHTML = '<em>original</em>';
  let closed = 0,
    historiesClosed = 0;
  const Root = defineComponent({ selector: 'failing-shell', $template: '<p>root</p>' });
  const Page = definePage({ selector: 'failing-page', $template: '<p>page</p>' });
  const app = defineApplication({
    root: Root,
    routes: [{ path: '/', page: Page }],
    router: {
      history() {
        const history = createMemoryHistoryDriver('/');
        return {
          ...history,
          dispose() {
            historiesClosed++;
            history.dispose();
          },
        };
      },
      guards(context) {
        context.own(() => {
          closed++;
        });
        throw new Error('guard setup failed');
      },
    },
  });
  await assert.rejects(mountApplication(host, app), /guard setup failed/);
  assert.equal(closed, 1);
  assert.equal(historiesClosed, 1);
  assert.equal(host.innerHTML, '<em>original</em>');
});

test('identity invalidation synchronously removes the protected page and its owned activities', async () => {
  const f = fixture(),
    app = await f.mount();
  await app.root.exposed.auth.login('editor');
  await app.router.push('/edit');
  assert.equal(f.counts().mounted, 1);
  assert.equal(f.counts().released, 0);
  app.root.exposed.auth.invalidate();
  assert.equal(app.router.current(), null);
  assert.equal(f.counts().released, 1);
  assert.equal(f.host.textContent?.includes('private'), false);
  assert.equal((await app.router.replace('/')).status, 'committed');
  await app.root.exposed.auth.login('player');
  assert.equal(app.router.current()?.path, '/');
  app.dispose();
  assert.equal(f.counts().released, 1);
});

test('identity change after guard approval cancels preparation and cannot mount a late protected result', async () => {
  let finish!: (value: Record<string, unknown>) => void;
  const f = fixture({
    prepare: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const app = await f.mount();
  await app.root.exposed.auth.login('editor');
  const pending = app.router.push('/edit');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.counts().mounted, 0);
  await app.root.exposed.auth.login('player');
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(app.router.current(), null);
  finish({});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.counts().mounted, 0);
  assert.equal((await app.router.replace('/edit')).status, 'redirected');
  assert.equal(app.router.current()?.path, '/forbidden');
  app.dispose();
});

test('identity invalidation cancels an approved module load and ignores the late module result', async () => {
  let finish!: () => void;
  const f = fixture({
    beforeLoad: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const app = await f.mount();
  await app.root.exposed.auth.login('editor');
  const pending = app.router.push('/edit');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.counts().loaded, 1);
  assert.equal(f.counts().prepared, 0);
  app.root.exposed.auth.invalidate();
  assert.deepEqual(await pending, { status: 'cancelled' });
  finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.counts().prepared, 0);
  assert.equal(f.counts().mounted, 0);
  assert.equal(app.router.current(), null);
  app.dispose();
});
