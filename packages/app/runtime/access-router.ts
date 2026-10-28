import type { CancellationSignal, Scope, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AuthUser, AuthService } from './auth.js';
import {
  AccessError,
  type AccessDecision,
  type AccessPolicy,
  type AccessService,
} from './access.js';
import type { Router } from './router/router.js';
import type {
  RouteGuard,
  RouteLocation,
  RouteTarget,
  GuardResult,
  RouteDefinition,
} from './router/types.js';

export interface AccessGuardOptions<
  K extends string,
  R extends readonly RouteDefinition[] = readonly RouteDefinition[],
> {
  readonly access: Pick<AccessService<K, AuthUser>, 'check'>;
  readonly resolve: (target: RouteTarget<R>) => RouteLocation;
  readonly anonymous?: (returnTo: string) => RouteTarget<R>;
  readonly forbidden?: RouteTarget<R>;
}
async function waitForDecision(
  work: Promise<AccessDecision>,
  signal: CancellationSignal,
): Promise<AccessDecision> {
  let off = () => {};
  const cancelled = new Promise<AccessDecision>((resolve) => {
    off = signal.subscribe(() => resolve({ status: 'deny', reason: 'cancelled' }));
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    off();
  }
}

/** Assemble into application router.guards; the Router itself stays auth-independent. */
export function createAccessGuard<
  K extends string,
  R extends readonly RouteDefinition[] = readonly RouteDefinition[],
>(options: AccessGuardOptions<K, R>): RouteGuard {
  return async (context): Promise<GuardResult> => {
    for (const match of context.to.matched) {
      if (context.signal.aborted) return { status: 'deny', reason: 'cancelled' };
      const decision = await waitForDecision(
        options.access.check(match.meta.access as AccessPolicy<K>),
        context.signal,
      );
      if (context.signal.aborted) return { status: 'deny', reason: 'cancelled' };
      if (decision.status === 'allow') continue;
      const target =
        decision.reason === 'anonymous' && options.anonymous
          ? options.anonymous(context.to.fullPath)
          : decision.reason === 'forbidden'
            ? options.forbidden
            : undefined;
      if (target === undefined) return { status: 'deny', reason: decision };
      try {
        const resolved = options.resolve(target);
        if (
          resolved.fullPath === context.to.fullPath ||
          resolved.matched.some(
            (record) => record.meta.access !== 'public' || record.redirect !== undefined,
          )
        )
          throw new Error(
            'Access redirects require a different explicitly public application route',
          );
        return { status: 'redirect', target: resolved.fullPath };
      } catch (cause) {
        return { status: 'deny', reason: new AccessError('redirect', cause) };
      }
    }
    return { status: 'allow' };
  };
}

export interface AccessReturnOptions<
  R extends readonly RouteDefinition[] = readonly RouteDefinition[],
> {
  readonly resolve: (target: RouteTarget<R>) => RouteLocation;
  readonly login: RouteTarget<R>;
  readonly fallback: RouteTarget<R>;
}

/** Resolve an untrusted, already query-decoded return path; navigation still runs guards. */
export function resolveAccessReturnTarget<R extends readonly RouteDefinition[]>(
  value: unknown,
  options: AccessReturnOptions<R>,
): string {
  let login: RouteLocation, fallback: RouteLocation;
  try {
    login = options.resolve(options.login);
    fallback = options.resolve(options.fallback);
    if (
      login.path === fallback.path ||
      [login, fallback].some(
        (location) =>
          !location.matched.length ||
          location.matched.some(
            (record) => record.meta.access !== 'public' || record.redirect !== undefined,
          ),
      )
    )
      throw new Error('Login and fallback must be different explicitly public non-redirect routes');
  } catch (cause) {
    throw new AccessError('return-target-config', cause);
  }
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return fallback.fullPath;
  try {
    // The application's resolver applies its strict path/query/hash parsing and route matching.
    const target = options.resolve(value);
    if (
      target.path === login.path ||
      !target.matched.length ||
      target.matched.some((record) => record.redirect !== undefined)
    )
      return fallback.fullPath;
    return target.fullPath;
  } catch {
    return fallback.fullPath;
  }
}

/** Install at the application/root lifetime alongside createAccessGuard. */
export function bindAccessRouter<R extends readonly RouteDefinition[]>(options: {
  readonly auth: Pick<AuthService<never, AuthUser>, 'registerCleanup'>;
  readonly router: Pick<Router<R>, 'current' | 'pending' | 'invalidate'>;
  readonly scope: Scope;
}): Cleanup {
  const protectedRoute = (location: RouteLocation | null | undefined): boolean =>
    !!location && location.matched.some((record) => record.meta.access !== 'public');
  return options.auth.registerCleanup(() => {
    if (protectedRoute(options.router.current()) || protectedRoute(options.router.pending()?.to))
      options.router.invalidate();
  }, options.scope);
}
