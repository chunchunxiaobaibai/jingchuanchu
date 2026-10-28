import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope, Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import { AuthService } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createHttpAuthProvider } from '../examples/auth-adapter/client.js';
import { HttpAuthError } from '../examples/auth-adapter/protocol.js';
const origin = 'https://game.example';
const anonymous = { user: null, csrfToken: 'anonymous-csrf' };
const displayUser = { id: 'player', displayName: 'Player', permissions: ['play'] };
function adapter(fetch: typeof globalThis.fetch) {
  const scope = new Scope();
  const provider = createHttpAuthProvider({
    applicationOrigin: origin,
    baseURL: origin + '/api/auth',
    fetch,
  });
  return { scope, provider, auth: new AuthService({ scope, provider }) };
}

test('HTTP Provider uses same-origin cookie/CSRF requests and exposes only decoded display identity', async () => {
  const calls: { url: string; request: RequestInit }[] = [];
  const f = adapter(async (input, request) => {
    calls.push({ url: String(input), request: request! });
    if (String(input).endsWith('/session')) return Response.json(anonymous, { status: 401 });
    if (String(input).endsWith('/login'))
      return Response.json({
        user: { ...displayUser, password: 'never-forward', token: 'never-forward' },
        csrfToken: 'user-csrf',
        token: 'never-forward',
      });
    if (String(input).endsWith('/logout')) return new Response(null, { status: 204 });
    return Response.json({ reward: 1 });
  });
  assert.equal(calls.length, 0);
  const result = await f.auth.login({ username: 'player', password: 'request-only' });
  assert.deepEqual(result, { status: 'authenticated', user: displayUser });
  assert.deepEqual(f.auth.session(), result);
  assert.equal(calls[0]!.url, origin + '/api/auth/session');
  assert.equal(calls[1]!.request.credentials, 'same-origin');
  assert.equal(calls[1]!.request.redirect, 'error');
  assert.equal(
    (calls[1]!.request.headers as Record<string, string>)['X-CSRF-Token'],
    'anonymous-csrf',
  );
  assert.deepEqual(JSON.parse(calls[1]!.request.body as string), {
    username: 'player',
    password: 'request-only',
  });
  assert.deepEqual(await f.provider.claimReward(new Cancellation()), { reward: 1 });
  assert.equal((calls[2]!.request.headers as Record<string, string>)['X-CSRF-Token'], 'user-csrf');
  assert.deepEqual(await f.auth.logout(), { status: 'logged-out', remoteRevocation: 'confirmed' });
  assert.equal(f.auth.session().status, 'anonymous');
  f.scope.dispose();
});

test('expired responses become anonymous, outages/malformed responses fail, and failed revocation remains unconfirmed', async () => {
  let status = 401,
    malformed = false;
  const f = adapter(async (input) =>
    String(input).endsWith('/logout')
      ? new Response(null, { status: 503 })
      : Response.json(malformed ? { user: displayUser, csrfToken: 'bad-expiry' } : anonymous, {
          status,
        }),
  );
  assert.deepEqual(await f.auth.ensureSession(), { status: 'anonymous' });
  status = 503;
  f.auth.invalidate();
  const outage = await f.auth.ensureSession();
  assert.equal(outage.status, 'failed');
  if (outage.status === 'failed') assert.equal((outage.error.cause as HttpAuthError).status, 503);
  status = 401;
  malformed = true;
  assert.equal((await f.auth.ensureSession()).status, 'failed');
  malformed = false;
  assert.deepEqual(await f.auth.ensureSession(), { status: 'anonymous' });
  const logout = await f.auth.logout();
  assert.equal(logout.status, 'failed');
  if (logout.status === 'failed') {
    assert.equal(logout.localCleared, true);
    assert.equal(logout.remoteRevocation, 'unconfirmed');
  }
  assert.equal(f.auth.session().status, 'anonymous');
  f.scope.dispose();
});

test('cancellation signals transport abort during body waiting and cannot install a late CSRF token', async () => {
  let finish!: (value: unknown) => void, transportSignal: AbortSignal | undefined;
  const requests: RequestInit[] = [];
  let first = true;
  const f = adapter(async (input, request) => {
    requests.push(request!);
    if (first) {
      first = false;
      transportSignal = request!.signal!;
      return {
        status: 200,
        json: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      } as Response;
    }
    return String(input).endsWith('/login')
      ? Response.json({ user: displayUser, csrfToken: 'login-csrf' })
      : Response.json(anonymous);
  });
  const pending = f.auth.ensureSession();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.auth.invalidate();
  assert.equal(transportSignal!.aborted, true);
  assert.deepEqual(await pending, { status: 'cancelled' });
  finish({ user: displayUser, csrfToken: 'late-token' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.auth.login({ username: 'player', password: 'request-only' });
  assert.equal(requests.length, 3);
  assert.equal((requests[2]!.headers as Record<string, string>)['X-CSRF-Token'], 'anonymous-csrf');
  assert.equal(f.auth.session().status, 'authenticated');
  f.scope.dispose();
});

test('cross-origin API configuration is rejected before any network request', () => {
  assert.throws(
    () =>
      createHttpAuthProvider({ applicationOrigin: origin, baseURL: 'https://other.example/api' }),
    /origin/,
  );
});
