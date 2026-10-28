import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope, Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import { AuthService, AccessService } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createHttpAuthProvider } from '../examples/auth-adapter/client.js';
import { createExampleAuthBackend } from '../examples/auth-adapter/server.js';
import { HttpAuthError, permissions, type User } from '../examples/auth-adapter/protocol.js';
const origin = 'https://game.example',
  basePath = '/api/auth';
function fixture() {
  let now = 1000,
    rejectRevoke = false;
  const backend = createExampleAuthBackend({
    origin,
    basePath,
    now: () => now,
    ttlMs: 1000,
    authenticate(input): User | null {
      if (input.password !== 'test-only-password' || !['member', 'admin'].includes(input.username))
        return null;
      return {
        id: input.username,
        displayName: input.username,
        permissions: input.username === 'admin' ? [...permissions] : ['play'],
      };
    },
    beforeRevoke() {
      if (rejectRevoke) throw new Error('injected revocation failure');
    },
  });
  let cookie = '',
    csrf = '';
  const transport: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('cookie', cookie);
    if (init?.method === 'POST') headers.set('origin', origin);
    const response = await backend.handle(new Request(String(input), { ...init, headers }));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    if (response.headers.get('content-type')?.includes('application/json')) {
      const envelope: unknown = await response.clone().json();
      if (
        envelope &&
        typeof envelope === 'object' &&
        'csrfToken' in envelope &&
        typeof envelope.csrfToken === 'string'
      )
        csrf = envelope.csrfToken;
    }
    return response;
  };
  const scope = new Scope(),
    provider = createHttpAuthProvider({
      applicationOrigin: origin,
      baseURL: origin + basePath,
      fetch: transport,
    });
  const auth = new AuthService({ scope, provider });
  async function directReward(extra: Record<string, string> = {}, body: unknown = {}) {
    return backend.handle(
      new Request(origin + basePath + '/reward', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          cookie,
          'x-csrf-token': csrf,
          ...extra,
        },
        body: JSON.stringify(body),
      }),
    );
  }
  return {
    backend,
    provider,
    auth,
    scope,
    directReward,
    cookie: () => cookie,
    csrf: () => csrf,
    advance: () => {
      now += 1001;
    },
    failRevoke: (value: boolean) => {
      rejectRevoke = value;
    },
  };
}

test('Provider and backend rotate real cookie/CSRF values; bypassing frontend permissions still yields server 401/403', async () => {
  const f = fixture();
  try {
    assert.equal((await f.directReward()).status, 401);
    assert.deepEqual(await f.auth.ensureSession(), { status: 'anonymous' });
    const anonymousCookie = f.cookie(),
      anonymousCsrf = f.csrf();
    await f.auth.login({ username: 'member', password: 'test-only-password' });
    assert.notEqual(f.cookie(), anonymousCookie);
    assert.notEqual(f.csrf(), anonymousCsrf);
    const access = new AccessService({
      auth: f.auth,
      keys: permissions,
      permissions: (user) => user.permissions,
    });
    assert.equal(access.can({ session: 'required', all: ['claim-reward'] }), false);
    // Skip can/guards entirely, and even submit forged client identity/claims.
    assert.equal(
      (await f.directReward({}, { user: { id: 'admin', permissions: ['claim-reward'] } })).status,
      403,
    );
    await assert.rejects(
      f.provider.claimReward(new Cancellation()),
      (error) => error instanceof HttpAuthError && error.status === 403,
    );
    assert.equal(f.auth.session().status, 'authenticated');
    await f.auth.login({ username: 'admin', password: 'test-only-password' });
    assert.equal(access.can({ session: 'required', all: ['claim-reward'] }), true);
    assert.deepEqual(await f.provider.claimReward(new Cancellation()), { reward: 1 });
    assert.equal((await f.directReward({ 'x-csrf-token': anonymousCsrf })).status, 403);
    assert.equal((await f.directReward({ origin: 'https://outside.example' })).status, 403);
    assert.equal((await f.directReward({ cookie: '' })).status, 401);
    const restored = await f.provider.restore(new Cancellation());
    assert.equal(f.provider.decode(restored).status, 'authenticated');
    const response = await f.backend.handle(
      new Request(origin + basePath + '/session', { headers: { cookie: f.cookie() } }),
    );
    assert.match(response.headers.get('set-cookie')!, /Path=\/; Secure; HttpOnly; SameSite=Lax/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    f.advance();
    assert.equal((await f.directReward()).status, 401);
    f.auth.invalidate();
    assert.deepEqual(await f.auth.ensureSession(), { status: 'anonymous' });
  } finally {
    f.scope.dispose();
    f.backend.dispose();
  }
});

test('failed backend revocation leaves a remotely usable session but local AuthService remains anonymous', async () => {
  const f = fixture();
  try {
    await f.auth.login({ username: 'admin', password: 'test-only-password' });
    const oldCookie = f.cookie(),
      oldCsrf = f.csrf();
    f.failRevoke(true);
    const result = await f.auth.logout();
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.localCleared, true);
      assert.equal(result.remoteRevocation, 'unconfirmed');
      assert.equal((result.error.cause as HttpAuthError).status, 503);
    }
    assert.equal(f.auth.session().status, 'anonymous');
    // A local logout flag must not be mistaken for successful server revocation.
    assert.equal((await f.directReward()).status, 200);
    f.failRevoke(false);
    assert.deepEqual(await f.auth.logout(), {
      status: 'logged-out',
      remoteRevocation: 'confirmed',
    });
    assert.equal(
      (await f.directReward({ cookie: oldCookie, 'x-csrf-token': oldCsrf })).status,
      401,
    );
  } finally {
    f.scope.dispose();
    f.backend.dispose();
  }
});

test('invalid credentials never establish identity and login writes require the server CSRF session', async () => {
  const f = fixture();
  try {
    const result = await f.auth.login({ username: 'admin', password: 'wrong-test-input' });
    assert.equal(result.status, 'failed');
    assert.equal(f.auth.session().status, 'failed');
    const response = await f.backend.handle(
      new Request(origin + basePath + '/login', {
        method: 'POST',
        headers: {
          origin,
          cookie: f.cookie(),
          'content-type': 'application/json',
          'x-csrf-token': 'forged',
        },
        body: JSON.stringify({ username: 'admin', password: 'test-only-password' }),
      }),
    );
    assert.equal(response.status, 403);
    assert.equal((await f.directReward()).status, 401);
  } finally {
    f.scope.dispose();
    f.backend.dispose();
  }
});

test('an asynchronous credential verifier cannot revive an expired server session', async () => {
  let now = 1000,
    finish!: (user: User) => void;
  const backend = createExampleAuthBackend({
    origin,
    basePath,
    ttlMs: 1000,
    now: () => now,
    authenticate: () =>
      new Promise<User>((resolve) => {
        finish = resolve;
      }),
  });
  try {
    const initial = await backend.handle(new Request(origin + basePath + '/session'));
    const cookie = initial.headers.get('set-cookie')!.split(';')[0]!;
    const { csrfToken } = (await initial.json()) as { csrfToken: string };
    const pending = backend.handle(
      new Request(origin + basePath + '/login', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ username: 'admin', password: 'test-only-password' }),
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    now += 1001;
    finish({ id: 'admin', displayName: 'Admin', permissions: [...permissions] });
    const result = await pending;
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('set-cookie'), null);
  } finally {
    backend.dispose();
  }
});
