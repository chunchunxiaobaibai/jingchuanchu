import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AuthProvider } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createAuthRestorer } from '../packages/app/runtime/auth.js';
type User = { id: string; name: string };
function provider(restore: AuthProvider<string, User>['restore']): AuthProvider<string, User> {
  return {
    restore,
    async login() {
      throw new Error('Login is not part of restore checks');
    },
    async logout() {},
    decode(value) {
      if (value === null) return { status: 'anonymous' };
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        !('name' in value) ||
        typeof value.id !== 'string' ||
        typeof value.name !== 'string'
      )
        throw new Error('Invalid user response');
      return { status: 'authenticated', user: { id: value.id, name: value.name } };
    },
  };
}

test('restore is explicit, coalesces requests and stores only decoded readonly display identity', async () => {
  const scope = new Scope();
  let calls = 0,
    finish!: (value: unknown) => void;
  const auth = createAuthRestorer({
    scope,
    provider: provider(() => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  });
  assert.equal(auth.session().status, 'unknown');
  assert.equal(calls, 0);
  const first = auth.ensureSession();
  assert.equal(auth.ensureSession(), first);
  assert.equal(auth.session().status, 'restoring');
  finish({ id: 'alice', name: 'Alice', token: 'not part of display identity' });
  const result = await first;
  assert.equal(result.status, 'authenticated');
  if (result.status === 'authenticated') {
    assert.deepEqual(result.user, { id: 'alice', name: 'Alice' });
    assert.equal(Reflect.set(result.user, 'id', 'bob'), false);
  }
  await auth.ensureSession();
  assert.equal(calls, 1);
  scope.dispose();
});

test('restore failures are distinct from anonymous and a subsequent explicit request may retry', async () => {
  const scope = new Scope();
  let fail = true;
  const cause = new Error('network unavailable');
  const auth = createAuthRestorer({
    scope,
    provider: provider(async () => {
      if (fail) throw cause;
      return null;
    }),
  });
  const failed = await auth.ensureSession();
  assert.equal(failed.status, 'failed');
  assert.equal(auth.session().status, 'failed');
  if (failed.status === 'failed') {
    assert.equal(failed.error.operation, 'restore');
    assert.equal(failed.error.cause, cause);
  }
  fail = false;
  assert.deepEqual(await auth.ensureSession(), { status: 'anonymous' });
  scope.dispose();
  const invalid = createAuthRestorer({
    scope: new Scope(),
    provider: provider(async () => ({ id: 42, name: 'invalid' })),
  });
  const decoded = await invalid.ensureSession();
  assert.equal(decoded.status, 'failed');
  if (decoded.status === 'failed') assert.equal(decoded.error.operation, 'decode');
  invalid.dispose();
});

test('generation change and exit settle ignored restore requests and prevent late identity resurrection', async () => {
  const scope = new Scope(),
    finish: ((value: unknown) => void)[] = [];
  const auth = createAuthRestorer({
    scope,
    provider: provider(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    ),
  });
  const first = auth.ensureSession();
  auth.invalidate();
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.equal(auth.generation, 1);
  const next = auth.ensureSession();
  finish[1]!({ id: 'bob', name: 'Bob' });
  assert.equal((await next).status, 'authenticated');
  finish[0]!({ id: 'alice', name: 'Alice' });
  await Promise.resolve();
  const current = auth.session();
  assert.equal(current.status, 'authenticated');
  if (current.status === 'authenticated') assert.equal(current.user.id, 'bob');
  auth.invalidate();
  const exiting = auth.ensureSession();
  scope.dispose();
  assert.deepEqual(await exiting, { status: 'cancelled' });
  finish[2]!({ id: 'late', name: 'Late' });
  await Promise.resolve();
  assert.equal(auth.session().status, 'unknown');
  assert.deepEqual(await auth.ensureSession(), { status: 'cancelled' });
});

test('identity cleanups are scoped, run on invalidation/exit and continue after another cleanup fails', async () => {
  const scope = new Scope(),
    registration = new Scope(),
    auth = createAuthRestorer({
      scope,
      provider: provider(async () => ({ id: 'alice', name: 'Alice' })),
    });
  await auth.ensureSession();
  let reset = 0,
    retired = 0;
  auth.registerCleanup(() => {
    retired++;
  }, registration);
  registration.dispose();
  const off = auth.registerCleanup(() => {
    throw new Error('cleanup failure');
  });
  auth.registerCleanup(() => {
    reset++;
  });
  assert.throws(() => auth.invalidate(), /invalidate failed/);
  assert.equal(reset, 1);
  assert.equal(retired, 0);
  assert.equal(auth.session().status, 'unknown');
  off();
  scope.dispose();
  assert.equal(reset, 2);
  assert.equal(auth.disposed, true);
});

test('Provider synchronous invalidation settles its own pending restore and does not poison the next request', async () => {
  const scope = new Scope();
  let auth!: ReturnType<typeof createAuthRestorer<string, User>>;
  const source = provider(() => {
    auth.invalidate();
    return new Promise(() => {});
  });
  auth = createAuthRestorer({ scope, provider: source });
  const outcome = await Promise.race([
    auth.ensureSession(),
    new Promise<'pending'>((resolve) => setImmediate(() => resolve('pending'))),
  ]);
  assert.deepEqual(outcome, { status: 'cancelled' });
  assert.equal(auth.session().status, 'unknown');
  source.restore = async () => ({ id: 'bob', name: 'Bob' });
  const next = await auth.ensureSession();
  assert.equal(next.status, 'authenticated');
  if (next.status === 'authenticated') assert.equal(next.user.id, 'bob');
  scope.dispose();
});

test('login clears registered user activity before Provider work and only the latest identity commits', async () => {
  const scope = new Scope(),
    source = provider(async () => null),
    pending: {
      input: string;
      finish: (value: unknown) => void;
      signal: import('@xiaobaibaifqy/jingchuanchu-core').CancellationSignal;
    }[] = [];
  let cleanups = 0;
  source.login = (input, signal) => {
    assert.ok(cleanups > 0);
    return new Promise((resolve) => {
      pending.push({ input, signal, finish: resolve });
    });
  };
  const auth = createAuthRestorer({ scope, provider: source });
  auth.registerCleanup(() => {
    cleanups++;
  });
  const alice = auth.login('alice');
  const bob = auth.login('bob');
  assert.equal(pending[0]!.signal.aborted, true);
  assert.deepEqual(await alice, { status: 'cancelled' });
  assert.equal(auth.generation, 2);
  pending[1]!.finish({ id: 'bob', name: 'Bob' });
  const result = await bob;
  assert.equal(result.status, 'authenticated');
  pending[0]!.finish({ id: 'alice', name: 'Alice' });
  await Promise.resolve();
  const current = auth.session();
  assert.equal(current.status, 'authenticated');
  if (current.status === 'authenticated') assert.equal(current.user.id, 'bob');
  scope.dispose();
});

test('logout clears local identity immediately and reports unconfirmed remote revocation without restoring old session', async () => {
  const scope = new Scope(),
    source = provider(async () => ({ id: 'alice', name: 'Alice' }));
  let revoke!: (cause: unknown) => void,
    cleaned = 0;
  source.logout = () =>
    new Promise((_, reject) => {
      revoke = reject;
    });
  const auth = createAuthRestorer({ scope, provider: source });
  await auth.ensureSession();
  auth.registerCleanup(() => {
    cleaned++;
  });
  const logout = auth.logout();
  assert.equal(auth.session().status, 'anonymous');
  assert.equal(cleaned, 1);
  assert.deepEqual(await auth.ensureSession(), { status: 'anonymous' });
  const cause = new Error('revocation failed');
  revoke(cause);
  const result = await logout;
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.localCleared, true);
    assert.equal(result.remoteRevocation, 'unconfirmed');
    assert.equal(result.error.cause, cause);
  }
  assert.equal(auth.session().status, 'anonymous');
  scope.dispose();
});

test('cleanup failures block login but do not skip remote logout; remote acknowledgement is reported separately', async () => {
  const scope = new Scope(),
    source = provider(async () => null);
  let logins = 0,
    logouts = 0,
    restores = 0;
  source.restore = async () => {
    restores++;
    return null;
  };
  source.login = async () => {
    logins++;
    return { id: 'alice', name: 'Alice' };
  };
  source.logout = async () => {
    logouts++;
  };
  const auth = createAuthRestorer({ scope, provider: source }),
    off = auth.registerCleanup(() => {
      throw new Error('cleanup failed');
    });
  assert.equal((await auth.login('alice')).status, 'failed');
  assert.equal(logins, 0);
  assert.equal((await auth.ensureSession()).status, 'failed');
  assert.equal(restores, 0);
  const result = await auth.logout();
  assert.equal(logouts, 1);
  assert.equal(auth.session().status, 'anonymous');
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.remoteRevocation, 'confirmed');
  off();
  assert.deepEqual(await auth.logout(), { status: 'logged-out', remoteRevocation: 'confirmed' });
  scope.dispose();
});

test('an ignored older logout cannot clear a subsequently confirmed login', async () => {
  const scope = new Scope(),
    source = provider(async () => ({ id: 'alice', name: 'Alice' }));
  let finish!: () => void;
  source.logout = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  source.login = async (input) => ({ id: input, name: input });
  const auth = createAuthRestorer({ scope, provider: source });
  await auth.ensureSession();
  const logout = auth.logout();
  const login = auth.login('bob');
  assert.deepEqual(await logout, { status: 'cancelled' });
  assert.equal((await login).status, 'authenticated');
  finish();
  await Promise.resolve();
  const current = auth.session();
  assert.equal(current.status, 'authenticated');
  if (current.status === 'authenticated') assert.equal(current.user.id, 'bob');
  scope.dispose();
});

test('public AuthService integrates optional lazy providers and isolated application user Stores', async () => {
  const { Window } = await import('happy-dom');
  const {
    AuthService,
    defineService,
    provideService,
    defineComponent,
    defineApplication,
    mountApplication,
    defineStore,
    signal,
  } = await import('@xiaobaibaifqy/jingchuanchu-app/application');
  let factories = 0,
    restores = 0;
  const requests: {
    finish: (value: unknown) => void;
    signal: import('@xiaobaibaifqy/jingchuanchu-core').CancellationSignal;
  }[] = [];
  const Auth = defineService({
    name: 'account',
    factory(context) {
      factories++;
      return new AuthService({
        scope: context.scope,
        provider: {
          ...provider((signal) => {
            restores++;
            return new Promise((finish) => requests.push({ finish, signal }));
          }),
          async login(name: string) {
            return { id: name, name };
          },
        },
      });
    },
  });
  const Game = defineStore({
    name: 'account-game',
    userScoped: true,
    setup() {
      const score = signal(0);
      return { state: { score }, getters: {}, actions: { add: () => score.update((n) => n + 1) } };
    },
  });
  const Root = defineComponent({
    selector: 'account-shell',
    $template: '<p>account</p>',
    setup(context) {
      const auth = context.useService(Auth),
        game = context.useStore(Game);
      auth.registerCleanup(() => game.reset(), context.scope);
      return { auth, game, shared: context.useService(Auth) };
    },
  });
  const SinglePlayer = defineComponent({ selector: 'solo-shell', $template: '<p>solo</p>' });
  const window = new Window();
  const host = () => window.document.createElement('div') as unknown as HTMLElement;
  const solo = await mountApplication(host(), defineApplication({ root: SinglePlayer }));
  const unused = await mountApplication(
    host(),
    defineApplication({ root: SinglePlayer, providers: [provideService(Auth)] }),
  );
  assert.equal(factories, 0);
  assert.equal(restores, 0);
  solo.dispose();
  unused.dispose();

  const definition = defineApplication({ root: Root, providers: [provideService(Auth)] });
  const one = await mountApplication(host(), definition),
    two = await mountApplication(host(), definition);
  const a = one.root.exposed,
    b = two.root.exposed;
  assert.equal(factories, 2);
  assert.equal(restores, 0);
  assert.equal(a.auth, a.shared);
  assert.notEqual(a.auth, b.auth);
  assert.equal(a.auth.session().status, 'unknown');
  const first = a.auth.ensureSession();
  assert.equal(a.auth.ensureSession(), first);
  const second = b.auth.ensureSession();
  assert.equal(restores, 2);
  requests[0]!.finish({ id: 'alice', name: 'Alice' });
  requests[1]!.finish({ id: 'bob', name: 'Bob' });
  assert.equal((await first).status, 'authenticated');
  assert.equal((await second).status, 'authenticated');
  a.game.actions.add();
  b.game.actions.add();
  await a.auth.login('carol');
  assert.equal(a.game.state.score(), 0);
  assert.equal(b.game.state.score(), 1);
  assert.deepEqual(b.auth.session(), { status: 'authenticated', user: { id: 'bob', name: 'Bob' } });
  a.game.actions.add();
  assert.deepEqual(await a.auth.logout(), { status: 'logged-out', remoteRevocation: 'confirmed' });
  assert.equal(a.game.state.score(), 0);
  a.auth.invalidate();
  const exiting = a.auth.ensureSession();
  one.dispose();
  assert.equal(requests[2]!.signal.aborted, true);
  assert.deepEqual(await exiting, { status: 'cancelled' });
  assert.equal(a.auth.disposed, true);
  requests[2]!.finish({ id: 'late', name: 'Late' });
  await Promise.resolve();
  assert.equal(a.auth.session().status, 'unknown');
  assert.equal(b.auth.session().status, 'authenticated');
  assert.equal(b.game.state.score(), 1);
  two.dispose();
});
