import {
  Cancellation,
  type Scope,
  type Cleanup,
  type CancellationSignal,
} from '@xiaobaibaifqy/jingchuanchu-core';
import { signal, SIGNAL, type ReadSignal } from './reactivity.js';
import { snapshot, type ReadonlyData } from '../state.js';
export interface AuthUser {
  readonly id: string;
}
export type AuthIdentity<U> =
  { readonly status: 'anonymous' } | { readonly status: 'authenticated'; readonly user: U };
export interface AuthProvider<LoginInput, U extends AuthUser> {
  restore(signal: CancellationSignal): PromiseLike<unknown>;
  login(input: LoginInput, signal: CancellationSignal): PromiseLike<unknown>;
  logout(signal: CancellationSignal): PromiseLike<void>;
  decode(value: unknown): AuthIdentity<U>;
}
export type AuthSession<U> =
  { readonly status: 'unknown' | 'restoring' | 'failed' } | AuthIdentity<ReadonlyData<U>>;
export type AuthResult<U> =
  | AuthIdentity<ReadonlyData<U>>
  | { readonly status: 'failed'; readonly error: AuthError }
  | { readonly status: 'cancelled' };
export class AuthError extends Error {
  readonly module = 'auth-session';
  readonly source = 'auth';
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Auth ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`, {
      cause,
    });
    this.name = 'AuthError';
  }
}

export type AuthLogoutResult =
  | { readonly status: 'logged-out'; readonly remoteRevocation: 'confirmed' }
  | {
      readonly status: 'failed';
      readonly localCleared: true;
      readonly remoteRevocation: 'confirmed' | 'unconfirmed';
      readonly error: AuthError;
    }
  | { readonly status: 'cancelled' };

/** Internal session core shared by the public service and direct core checks. */
export function createAuthRestorer<L, U extends AuthUser>(options: {
  scope: Scope;
  provider: AuthProvider<L, U>;
}) {
  const { provider } = options;
  if (
    !provider ||
    ['restore', 'login', 'logout', 'decode'].some(
      (key) => typeof provider[key as keyof typeof provider] !== 'function',
    )
  )
    throw new AuthError('create', new Error('Complete AuthProvider methods are required'));
  const state = signal<AuthSession<U>>({ status: 'unknown' });
  const session = Object.freeze(
    Object.defineProperty(() => state(), SIGNAL, { value: true }),
  ) as ReadSignal<AuthSession<U>>;
  let closed = false,
    generation = 0,
    invalidating = false;
  const cleanups = new Set<() => void>();
  let cleanupFailure: AuthError | undefined;
  let pending:
    | {
        kind: 'restore' | 'login' | 'logout';
        promise: Promise<AuthResult<U>>;
        cancellation: Cancellation;
      }
    | undefined;
  const invalidate = (): void => {
    if (invalidating)
      throw new AuthError('invalidate', new Error('Identity cleanup is already running'));
    generation++;
    const previous = pending;
    pending = undefined;
    state.set({ status: 'unknown' });
    invalidating = true;
    const errors: unknown[] = [];
    try {
      try {
        previous?.cancellation.cancel();
      } catch (error) {
        errors.push(error);
      }
      for (const cleanup of [...cleanups])
        if (cleanups.has(cleanup))
          try {
            const result: unknown = cleanup();
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              void Promise.resolve(result).catch(() => {});
              throw new Error('Identity cleanup must be synchronous');
            }
          } catch (error) {
            errors.push(new AuthError('identity-cleanup', error));
          }
    } finally {
      invalidating = false;
    }
    cleanupFailure = errors.length
      ? new AuthError('invalidate', new AggregateError(errors))
      : undefined;
    if (cleanupFailure) throw cleanupFailure;
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    try {
      invalidate();
    } finally {
      cleanups.clear();
    }
  };
  options.scope.own(dispose);
  if (closed) throw new AuthError('create', new Error('Scope is disposed'));
  const perform = (
    kind: 'restore' | 'login' | 'logout',
    action: (signal: CancellationSignal) => PromiseLike<unknown>,
  ): Promise<AuthResult<U>> => {
    if (closed || invalidating) return Promise.resolve({ status: 'cancelled' });
    const ticket = generation,
      cancellation = new Cancellation();
    state.set(kind === 'logout' ? { status: 'anonymous' } : { status: 'restoring' });
    let off: Cleanup = () => {};
    const aborted = new Promise<'cancelled'>((resolve) => {
      off = cancellation.subscribe(() => resolve('cancelled'));
    });
    let resolveWork!: (value: unknown) => void, rejectWork!: (error: unknown) => void;
    const work = new Promise<unknown>((resolve, reject) => {
      resolveWork = resolve;
      rejectWork = reject;
    });
    let operation: string = kind;
    const promise: Promise<AuthResult<U>> = Promise.race([
      work.then((value) => ({ value })),
      aborted,
    ])
      .then((outcome): AuthResult<U> => {
        if (outcome === 'cancelled' || closed || ticket !== generation)
          return { status: 'cancelled' };
        if (kind === 'logout') {
          state.set({ status: 'anonymous' });
          return { status: 'anonymous' };
        }
        operation = 'decode';
        const identity = provider.decode(outcome.value);
        if (identity && typeof (identity as unknown as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(identity).catch(() => {});
          throw new Error('Auth decoder must be synchronous');
        }
        if (!identity || !['anonymous', 'authenticated'].includes(identity.status))
          throw new Error('Invalid decoded identity');
        let decoded: AuthIdentity<ReadonlyData<U>>;
        if (identity.status === 'anonymous') decoded = { status: 'anonymous' };
        else {
          if (
            !identity.user ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(identity.user)) ||
            typeof identity.user.id !== 'string' ||
            !identity.user.id.trim()
          )
            throw new Error('Authenticated user requires a nonempty id');
          decoded = { status: 'authenticated', user: snapshot(identity.user) };
        }
        if (closed || ticket !== generation) return { status: 'cancelled' };
        state.set(decoded as AuthSession<U>);
        return decoded;
      })
      .catch((cause): AuthResult<U> => {
        if (closed || ticket !== generation) return { status: 'cancelled' };
        state.set(kind === 'logout' ? { status: 'anonymous' } : { status: 'failed' });
        return { status: 'failed', error: new AuthError(operation, cause) };
      })
      .finally(() => {
        off();
        if (pending?.promise === promise) pending = undefined;
      });
    pending = { kind, promise, cancellation };
    // External code may invalidate synchronously, so publish the pending request first.
    try {
      const result = action(cancellation);
      if (result === promise) throw new Error('Provider cannot await its own session request');
      void Promise.resolve(result).then(resolveWork, rejectWork);
    } catch (error) {
      rejectWork(error);
    }
    return promise;
  };
  return Object.freeze({
    session,
    get generation() {
      return generation;
    },
    get disposed() {
      return closed;
    },
    registerCleanup(cleanup: () => void, scope?: Scope): Cleanup {
      if (closed) throw new AuthError('register-cleanup', new Error('Auth owner is disposed'));
      if (typeof cleanup !== 'function')
        throw new AuthError('register-cleanup', new Error('Expected a cleanup function'));
      const entry = () => cleanup();
      cleanups.add(entry);
      const off = () => {
        cleanups.delete(entry);
      };
      scope?.own(off);
      return off;
    },
    invalidate() {
      if (!closed) invalidate();
    },
    dispose,
    ensureSession(): Promise<AuthResult<U>> {
      if (closed || invalidating) return Promise.resolve({ status: 'cancelled' });
      if (pending)
        return pending.kind === 'logout'
          ? Promise.resolve({ status: 'anonymous' })
          : pending.promise;
      const current = state();
      if (current.status === 'anonymous' || current.status === 'authenticated')
        return Promise.resolve(current as AuthIdentity<ReadonlyData<U>>);
      if (cleanupFailure) {
        try {
          invalidate();
        } catch (error) {
          if (closed) return Promise.resolve({ status: 'cancelled' });
          state.set({ status: 'failed' });
          return Promise.resolve({ status: 'failed', error: error as AuthError });
        }
      }
      return perform('restore', (signal) => provider.restore(signal));
    },
    login(input: L): Promise<AuthResult<U>> {
      if (closed || invalidating) return Promise.resolve({ status: 'cancelled' });
      try {
        invalidate();
      } catch (error) {
        if (closed) return Promise.resolve({ status: 'cancelled' });
        state.set({ status: 'failed' });
        return Promise.resolve({
          status: 'failed',
          error: error instanceof AuthError ? error : new AuthError('login-cleanup', error),
        });
      }
      return perform('login', (signal) => provider.login(input, signal));
    },
    logout(): Promise<AuthLogoutResult> {
      if (closed || invalidating) return Promise.resolve({ status: 'cancelled' });
      let cleanupError: unknown;
      try {
        invalidate();
      } catch (error) {
        cleanupError = error;
      }
      if (closed) return Promise.resolve({ status: 'cancelled' });
      state.set({ status: 'anonymous' });
      return perform('logout', (signal) => provider.logout(signal)).then(
        (result): AuthLogoutResult => {
          if (result.status === 'cancelled') return result;
          if (result.status === 'failed')
            return {
              status: 'failed',
              localCleared: true,
              remoteRevocation: 'unconfirmed',
              error: cleanupError
                ? new AuthError('logout', new AggregateError([cleanupError, result.error]))
                : result.error,
            };
          if (cleanupError)
            return {
              status: 'failed',
              localCleared: true,
              remoteRevocation: 'confirmed',
              error: new AuthError('logout-cleanup', cleanupError),
            };
          return { status: 'logged-out', remoteRevocation: 'confirmed' };
        },
      );
    },
  });
}

/** Optional owner-scoped session service; constructing it does not restore a session. */
export class AuthService<L, U extends AuthUser> {
  readonly #core: ReturnType<typeof createAuthRestorer<L, U>>;
  readonly session: ReadSignal<AuthSession<U>>;

  constructor(options: { scope: Scope; provider: AuthProvider<L, U> }) {
    this.#core = createAuthRestorer(options);
    this.session = this.#core.session;
    Object.freeze(this);
  }

  get generation(): number {
    return this.#core.generation;
  }
  get disposed(): boolean {
    return this.#core.disposed;
  }
  ensureSession = (): Promise<AuthResult<U>> => this.#core.ensureSession();
  login = (input: L): Promise<AuthResult<U>> => this.#core.login(input);
  logout = (): Promise<AuthLogoutResult> => this.#core.logout();
  invalidate = (): void => this.#core.invalidate();
  dispose = (): void => this.#core.dispose();
  registerCleanup = (cleanup: () => void, scope?: Scope): Cleanup =>
    this.#core.registerCleanup(cleanup, scope);
}
