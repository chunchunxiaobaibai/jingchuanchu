import type { AuthService, AuthUser } from './auth.js';

export type AccessPolicy<K extends string = string> =
  | 'public'
  | { readonly session: 'required'; readonly all?: readonly K[]; readonly any?: readonly K[] };
export type AccessDecision =
  | { readonly status: 'allow' }
  | {
      readonly status: 'deny';
      readonly reason:
        | 'invalid-policy'
        | 'session-unconfirmed'
        | 'anonymous'
        | 'session-failed'
        | 'forbidden'
        | 'invalid-permissions'
        | 'cancelled';
      readonly cause?: unknown;
    };
export class AccessError extends Error {
  readonly module = 'access-policy';
  readonly source = 'access';
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Access ${operation} failed`, { cause });
    this.name = 'AccessError';
  }
}
type SessionSource<U extends AuthUser> = Pick<
  AuthService<never, U>,
  'session' | 'ensureSession' | 'generation' | 'disposed'
>;

/** Display/navigation decisions only; backend requests still require server authorization. */
export class AccessService<K extends string, U extends AuthUser> {
  readonly #auth: SessionSource<U>;
  readonly #keys: ReadonlySet<string>;
  readonly #permissions: (
    user: Extract<ReturnType<SessionSource<U>['session']>, { status: 'authenticated' }>['user'],
  ) => readonly K[];

  constructor(options: {
    auth: SessionSource<U>;
    keys: readonly K[];
    permissions: (
      user: Extract<ReturnType<SessionSource<U>['session']>, { status: 'authenticated' }>['user'],
    ) => readonly K[];
  }) {
    if (
      !Array.isArray(options.keys) ||
      options.keys.some((key) => typeof key !== 'string' || !key.trim()) ||
      new Set(options.keys).size !== options.keys.length ||
      typeof options.permissions !== 'function'
    )
      throw new AccessError(
        'create',
        new Error('Unique nonempty permission keys and a selector are required'),
      );
    this.#auth = options.auth;
    this.#keys = new Set(options.keys);
    this.#permissions = options.permissions;
    Object.freeze(this);
  }

  #valid(policy: unknown): policy is AccessPolicy<K> {
    if (policy === 'public') return true;
    if (!policy || typeof policy !== 'object') return false;
    const value = policy as Record<string, unknown>;
    return (
      value.session === 'required' &&
      Object.keys(value).every((key) => ['session', 'all', 'any'].includes(key)) &&
      ['all', 'any'].every(
        (key) =>
          value[key] === undefined ||
          (Array.isArray(value[key]) &&
            value[key].every((item: unknown) => typeof item === 'string' && this.#keys.has(item))),
      )
    );
  }

  #evaluate(policy: AccessPolicy<K>): AccessDecision {
    if (this.#auth.disposed) return { status: 'deny', reason: 'cancelled' };
    if (!this.#valid(policy)) return { status: 'deny', reason: 'invalid-policy' };
    if (policy === 'public') return { status: 'allow' };
    const session = this.#auth.session();
    if (session.status === 'anonymous') return { status: 'deny', reason: 'anonymous' };
    if (session.status === 'failed') return { status: 'deny', reason: 'session-failed' };
    if (session.status !== 'authenticated')
      return { status: 'deny', reason: 'session-unconfirmed' };
    const generation = this.#auth.generation;
    try {
      const claims = this.#permissions(session.user);
      if (
        !Array.isArray(claims) ||
        claims.some((key) => typeof key !== 'string' || !this.#keys.has(key))
      ) {
        // Consume a mistakenly async selector's rejection while rejecting its output.
        if (claims && typeof (claims as unknown as PromiseLike<unknown>).then === 'function')
          void Promise.resolve(claims).catch(() => {});
        return { status: 'deny', reason: 'invalid-permissions' };
      }
      const granted = new Set(claims);
      const allowed =
        (policy.all?.every((key) => granted.has(key)) ?? true) &&
        (policy.any?.some((key) => granted.has(key)) ?? true);
      if (this.#auth.disposed || generation !== this.#auth.generation)
        return { status: 'deny', reason: 'cancelled' };
      return allowed ? { status: 'allow' } : { status: 'deny', reason: 'forbidden' };
    } catch (cause) {
      return { status: 'deny', reason: 'invalid-permissions', cause };
    }
  }

  can(policy: AccessPolicy<K>): boolean {
    return this.#evaluate(policy).status === 'allow';
  }

  async check(policy: AccessPolicy<K>): Promise<AccessDecision> {
    if (!this.#valid(policy)) return { status: 'deny', reason: 'invalid-policy' };
    if (policy === 'public' || this.#auth.disposed) return this.#evaluate(policy);
    const generation = this.#auth.generation;
    const result = await this.#auth.ensureSession();
    if (
      this.#auth.disposed ||
      generation !== this.#auth.generation ||
      result.status === 'cancelled'
    )
      return { status: 'deny', reason: 'cancelled' };
    if (result.status === 'failed')
      return { status: 'deny', reason: 'session-failed', cause: result.error };
    return this.#evaluate(policy);
  }
}
