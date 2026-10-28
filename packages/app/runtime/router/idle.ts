import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { reportApplicationError } from '../errors.js';
import type { Router } from './router.js';
import { RouteError, type RouteDefinition, type RouteTarget } from './types.js';

export interface IdleScheduler {
  schedule(callback: () => void): Cleanup;
}
interface IdleHost {
  requestIdleCallback?(callback: () => void): number;
  cancelIdleCallback?(handle: number): void;
}
export function defaultIdleScheduler(host?: IdleHost | null): IdleScheduler {
  return {
    schedule(callback) {
      if (host?.requestIdleCallback && host.cancelIdleCallback) {
        const handle = host.requestIdleCallback(callback);
        return () => host.cancelIdleCallback!(handle);
      }
      const handle = setTimeout(callback, 0);
      return () => clearTimeout(handle);
    },
  };
}

/** Explicit finite targets; one scheduled job and at most one in-flight preload per queue. */
export function scheduleIdlePreloads<R extends readonly RouteDefinition[]>(
  router: Router<R>,
  targets: readonly RouteTarget<R>[],
  scheduler: IdleScheduler,
  onError?: (error: unknown) => void,
): Cleanup {
  const paths = [...new Set(targets.map((target) => router.resolve(target).fullPath))];
  let stopped = false,
    index = 0,
    cancel: Cleanup | undefined;
  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    const pending = cancel;
    cancel = undefined;
    pending?.();
  };
  const schedule = (): void => {
    if (stopped || index >= paths.length) return;
    cancel = scheduler.schedule(() => {
      cancel = undefined;
      if (stopped) return;
      const path = paths[index++]!;
      void router
        .preload(path, { trigger: 'idle' })
        .then(() => {
          if (!stopped) schedule();
        })
        .catch((cause) => {
          const errors = [cause];
          try {
            dispose();
          } catch (error) {
            errors.push(error);
          }
          reportApplicationError(
            new RouteError(
              path,
              'idle scheduling',
              errors.length === 1 ? cause : new AggregateError(errors),
            ),
            onError,
          );
        });
    });
  };
  schedule();
  return dispose;
}
