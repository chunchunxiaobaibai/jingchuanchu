import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  AuthService,
  AccessService,
  AccessError,
  type AuthProvider,
  type AccessPolicy,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const keys = ['play', 'edit', 'publish'] as const;
type Permission = (typeof keys)[number];
type User = { id: string; permissions: Permission[] };
function fixture(restore: AuthProvider<string, User>['restore']) {
  const scope = new Scope();
  const provider: AuthProvider<string, User> = {
    restore,
    async login(id) {
      return { id, permissions: ['play'] };
    },
    async logout() {},
    decode(value) {
      if (value === null) return { status: 'anonymous' };
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        !('permissions' in value) ||
        typeof value.id !== 'string' ||
        !Array.isArray(value.permissions) ||
        value.permissions.some((key) => !keys.includes(key))
      )
        throw new Error('Invalid user');
      return { status: 'authenticated', user: { id: value.id, permissions: value.permissions } };
    },
  };
  const auth = new AuthService({ scope, provider });
  const access = new AccessService({ auth, keys, permissions: (user) => user.permissions });
  return { scope, auth, access };
}

test('public checks are offline; missing/unknown policies fail closed before restoring', async () => {
  let requests = 0;
  const { scope, access, auth } = fixture(async () => {
    requests++;
    return null;
  });
  assert.equal(access.can('public'), true);
  assert.deepEqual(await access.check('public'), { status: 'allow' });
  for (const policy of [
    undefined,
    {},
    { session: 'required', all: ['unknown'] },
    { session: 'optional' },
  ]) {
    assert.equal(access.can(policy as AccessPolicy<Permission>), false);
    assert.deepEqual(await access.check(policy as AccessPolicy<Permission>), {
      status: 'deny',
      reason: 'invalid-policy',
    });
  }
  assert.equal(access.can({ session: 'required' }), false);
  assert.equal(auth.session().status, 'unknown');
  assert.equal(requests, 0);
  scope.dispose();
});

test('all and any compose and decisions use current confirmed claims without cached grants', async () => {
  const { scope, access, auth } = fixture(async () => ({
    id: 'author',
    permissions: ['play', 'edit'],
  }));
  assert.deepEqual(
    await access.check({ session: 'required', all: ['play'], any: ['edit', 'publish'] }),
    { status: 'allow' },
  );
  assert.equal(access.can({ session: 'required', all: ['publish'], any: ['play'] }), false);
  assert.equal(access.can({ session: 'required', all: ['play'], any: ['publish'] }), false);
  assert.equal(access.can({ session: 'required', all: [] }), true);
  assert.equal(access.can({ session: 'required', any: [] }), false);
  await auth.login('player');
  assert.equal(access.can({ session: 'required', all: ['edit'] }), false);
  assert.equal(access.can({ session: 'required', all: ['play'] }), true);
  await auth.logout();
  assert.deepEqual(await access.check({ session: 'required' }), {
    status: 'deny',
    reason: 'anonymous',
  });
  scope.dispose();
});

test('recovery deduplicates; failure remains distinct from anonymous and may retry explicitly', async () => {
  let finish!: (value: unknown) => void,
    requests = 0;
  const { scope, access, auth } = fixture(() => {
    requests++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = access.check({ session: 'required' }),
    second = access.check({ session: 'required' });
  assert.equal(requests, 1);
  assert.equal(auth.session().status, 'restoring');
  assert.equal(access.can({ session: 'required' }), false);
  finish({ malformed: true });
  const failed = await first;
  assert.equal(failed.status, 'deny');
  if (failed.status === 'deny') assert.equal(failed.reason, 'session-failed');
  assert.deepEqual(await second, failed);
  const retry = access.check({ session: 'required' });
  assert.equal(requests, 2);
  finish(null);
  assert.deepEqual(await retry, { status: 'deny', reason: 'anonymous' });
  scope.dispose();
});

test('identity changes and disposal deny pending decisions even if Provider ignores cancellation', async () => {
  let finish!: (value: unknown) => void;
  const { scope, access, auth } = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = access.check({ session: 'required', all: ['publish'] });
  await auth.login('new-player');
  assert.deepEqual(await pending, { status: 'deny', reason: 'cancelled' });
  finish({ id: 'old-admin', permissions: ['publish'] });
  await Promise.resolve();
  assert.equal(access.can({ session: 'required', all: ['publish'] }), false);
  auth.invalidate();
  const exiting = access.check({ session: 'required' });
  scope.dispose();
  assert.deepEqual(await exiting, { status: 'deny', reason: 'cancelled' });
  assert.equal(access.can('public'), false);
});

test('unknown claims and failing or async selectors cannot grant permissions', async () => {
  const { scope, auth } = fixture(async () => ({ id: 'player', permissions: ['play'] }));
  await auth.ensureSession();
  const selectors = [
    () => ['unknown'],
    () => {
      throw new Error('selector failed');
    },
    () => Promise.reject(new Error('async selector')),
  ];
  for (const permissions of selectors) {
    const access = new AccessService({
      auth,
      keys,
      permissions: permissions as unknown as () => Permission[],
    });
    assert.equal(access.can({ session: 'required' }), false);
    const result = await access.check({ session: 'required' });
    assert.equal(result.status, 'deny');
    if (result.status === 'deny') assert.equal(result.reason, 'invalid-permissions');
  }
  assert.throws(
    () => new AccessService({ auth, keys: ['play', 'play'], permissions: () => [] }),
    AccessError,
  );
  scope.dispose();
});

test('synchronous identity invalidation inside a permissions selector cannot grant stale claims', async () => {
  const { scope, auth } = fixture(async () => ({ id: 'player', permissions: ['play'] }));
  await auth.ensureSession();
  const access = new AccessService({
    auth,
    keys,
    permissions(user) {
      auth.invalidate();
      return user.permissions;
    },
  });
  assert.equal(access.can({ session: 'required', all: ['play'] }), false);
  assert.equal(auth.session().status, 'unknown');
  scope.dispose();
});
