import { Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import { snapshot } from '../../state.js';
import { signal, SIGNAL, type ReadSignal } from '../reactivity.js';
import { batch } from '../scheduler.js';
import { reportApplicationError } from '../errors.js';
import { createRouteMatcher, getRouteRecords } from './matcher.js';
import { RouteModuleLoader } from './loader.js';
import {
  RouteError,
  type RouteDefinition,
  type RouteTarget,
  type RouteLocation,
  type HistoryDriver,
  type HistoryEntry,
  type RouteRenderer,
  type RouteCandidate,
  type NavigationResult,
  type NavigationPending,
  type RouteDiagnostic,
  type NavigationContext,
  type GuardResult,
  type RouteGuard,
  type PreparedRoutePage,
  type RoutePreloadResult,
  type RoutePreloadOptions,
} from './types.js';
export interface Router<R extends readonly RouteDefinition[]> {
  readonly current: ReadSignal<RouteLocation | null>;
  readonly pending: ReadSignal<NavigationPending | null>;
  readonly error: ReadSignal<RouteDiagnostic | null>;
  resolve(target: RouteTarget<R>): RouteLocation;
  href(target: RouteTarget<R>): string;
  preload(target: RouteTarget<R>, options?: RoutePreloadOptions): Promise<RoutePreloadResult>;
  push(target: RouteTarget<R>): Promise<NavigationResult>;
  replace(target: RouteTarget<R>): Promise<NavigationResult>;
  back(): Promise<NavigationResult>;
  invalidate(): void;
  dispose(): void;
}
interface Navigation {
  id: number;
  live: boolean;
  mode: 'push' | 'replace' | 'pop';
  entry?: HistoryEntry;
  token: Cancellation;
  to?: RouteLocation;
  finish: (result: NavigationResult) => void;
  cancel: () => void;
}
const sameEntry = (a: HistoryEntry, b: HistoryEntry) =>
  a.position === b.position && a.fullPath === b.fullPath;
function readonly<T>(read: ReadSignal<T>): ReadSignal<T> {
  return Object.freeze(
    Object.defineProperty(() => read(), SIGNAL, { value: true }),
  ) as ReadSignal<T>;
}
function reuseDepth(from: RouteLocation | null, to: RouteLocation): number {
  if (!from) return 0;
  const previous = getRouteRecords(from),
    next = getRouteRecords(to),
    names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < Math.min(previous.length, next.length) - 1; i++) {
    if (previous[i] !== next[i]) break;
    for (const segment of next[i]!.path.split('/'))
      if (segment.startsWith(':') || segment.startsWith('*')) names.add(segment.slice(1));
    if ([...names].some((name) => from.params[name] !== to.params[name])) break;
    depth++;
  }
  return depth;
}
export function createRouter<const R extends readonly RouteDefinition[]>(options: {
  readonly routes: R;
  readonly history: HistoryDriver;
  readonly guards?: readonly RouteGuard[];
  readonly renderer: RouteRenderer;
  readonly onError?: (error: RouteError) => void;
}): Router<R> {
  const matcher = createRouteMatcher(options.routes),
    current = signal<RouteLocation | null>(null),
    pending = signal<NavigationPending | null>(null),
    error = signal<RouteDiagnostic | null>(null);
  const globalGuards = Object.freeze([...(options.guards ?? [])]);
  if (globalGuards.some((guard) => typeof guard !== 'function'))
    throw new RouteError('router', 'guards', new Error('Guards must be functions'));
  const modules = new RouteModuleLoader();
  const preloads = new Set<() => void>();
  let committedEntry = options.history.read(),
    committed: RouteLocation | null = null,
    view: RouteCandidate | undefined,
    active: Navigation | undefined,
    sequence = 0,
    disposed = false,
    historyTail: Promise<unknown> = Promise.resolve();
  let traversal:
    | { intent: number; started: boolean; result?: Promise<NavigationResult>; entry?: HistoryEntry }
    | undefined;
  const valid = (nav: Navigation) => !disposed && nav.live && active === nav;
  const routeError = (source: string, operation: string, cause: unknown) =>
    cause instanceof RouteError ? cause : new RouteError(source, operation, cause);
  const notify = (failure: RouteError) => {
    if (options.onError) reportApplicationError(failure, () => options.onError!(failure));
  };
  const diagnostic = (failure: RouteError): RouteDiagnostic => ({
    module: 'page-router',
    source: failure.source,
    operation: failure.operation,
    message: failure.message,
  });
  const report = (failure: RouteError, id: number) => {
    const visible = !disposed && sequence === id;
    if (visible) error.set(diagnostic(failure));
    if (options.onError) reportApplicationError(failure, () => options.onError!(failure));
    else if (!visible) reportApplicationError(failure);
  };
  const finishFailure = (nav: Navigation, failure: RouteError) => {
    if (!valid(nav)) return;
    batch(() => {
      error.set(diagnostic(failure));
      nav.finish({ status: 'failed', error: failure });
    });
    notify(failure);
  };
  const historyOperation = <T>(
    nav: Navigation,
    run: () => Promise<T> | T,
  ): Promise<T | undefined> => {
    const result = historyTail.then(() => (valid(nav) ? run() : undefined));
    historyTail = result.catch(() => {});
    return result;
  };
  async function rejectNavigation(nav: Navigation, result: NavigationResult): Promise<void> {
    await historyOperation(nav, async () => {
      if (!sameEntry(options.history.read(), committedEntry))
        await options.history.restore(committedEntry);
    });
    if (valid(nav)) {
      if (result.status === 'failed') finishFailure(nav, result.error);
      else nav.finish(result);
    }
  }
  async function run(nav: Navigation, initial: RouteTarget): Promise<void> {
    let target = initial,
      phase = 'resolve',
      candidate: RouteCandidate | undefined;
    const visited = new Set<string>(),
      redirects: string[] = [];
    try {
      for (;;) {
        if (!valid(nav)) return;
        phase = 'resolve';
        const to = matcher.resolve(target as RouteTarget<R>);
        nav.to = to;
        if (visited.has(to.fullPath) || visited.size >= 20)
          throw new Error('Route redirect loop or hop limit exceeded');
        visited.add(to.fullPath);
        pending.set({ id: nav.id, to });
        const records = getRouteRecords(to),
          last = records.at(-1)!;
        if (last.redirect !== undefined) {
          redirects.push(to.fullPath);
          target = last.redirect;
          continue;
        }
        const context: NavigationContext = {
          from: committed,
          to,
          params: to.params,
          query: to.query,
          hash: to.hash,
          signal: nav.token,
        };
        const depth = reuseDepth(committed, to),
          leaving = committed ? getRouteRecords(committed).slice(depth).reverse() : [];
        const guards = [
          ...leaving.flatMap((record) => (record.beforeLeave ? [record.beforeLeave] : [])),
          ...globalGuards,
          ...records.flatMap((record) => record.guards ?? []),
        ];
        let redirect: RouteTarget | undefined;
        phase = 'guard';
        for (const guard of guards) {
          const result: GuardResult = await guard(context);
          if (!valid(nav)) return;
          if (!result || !['allow', 'deny', 'redirect'].includes(result.status))
            throw new Error('Guard must return allow, deny or redirect');
          if (result.status === 'deny') {
            await rejectNavigation(nav, {
              status: 'denied',
              to,
              ...(result.reason !== undefined ? { reason: result.reason } : {}),
            });
            return;
          }
          if (result.status === 'redirect') {
            if (result.target === undefined) throw new Error('Redirect guard requires a target');
            redirect = result.target;
            break;
          }
        }
        if (redirect !== undefined) {
          redirects.push(to.fullPath);
          target = redirect;
          continue;
        }
        const views: PreparedRoutePage[] = [];
        phase = 'load';
        for (const record of records) {
          if (record.redirect !== undefined) continue;
          const loaded = modules.load(record);
          const page = loaded instanceof Promise ? await loaded : loaded;
          if (!valid(nav)) return;
          views.push({ record, page, inputs: {} });
        }
        phase = 'prepare';
        for (let i = 0; i < views.length; i++) {
          const prepared = views[i]!,
            inputs = prepared.record.prepare ? await prepared.record.prepare(context) : {};
          if (!valid(nav)) return;
          if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
            throw new Error('prepare must return a page input object');
          views[i] = { ...prepared, inputs: snapshot(inputs) };
        }
        phase = 'candidate';
        candidate = await options.renderer.create({
          ...context,
          views: Object.freeze(views.map((item) => Object.freeze(item))),
          reuseDepth: depth,
        });
        if (!valid(nav)) return;
        if (
          !candidate ||
          typeof candidate.commit !== 'function' ||
          typeof candidate.dispose !== 'function'
        )
          throw new Error('Renderer must return commit/dispose candidate methods');
        await historyOperation(nav, async () => {
          phase = 'history';
          if (nav.mode === 'pop') {
            if (!nav.entry || !sameEntry(options.history.read(), nav.entry))
              throw new Error('Pop history entry changed before commit');
          } else if (!sameEntry(options.history.read(), committedEntry))
            await options.history.restore(committedEntry);
          if (!valid(nav)) return;
          phase = 'commit';
          const rollback = candidate!.commit();
          if (typeof rollback !== 'function')
            throw new Error('Candidate commit must return a synchronous rollback function');
          if (!valid(nav)) {
            rollback();
            return;
          }
          let entry: HistoryEntry;
          try {
            phase = 'history';
            entry =
              nav.mode === 'pop'
                ? nav.entry!
                : nav.mode === 'push'
                  ? options.history.push(to.fullPath)
                  : options.history.replace(to.fullPath);
          } catch (historyError) {
            try {
              rollback();
            } catch (rollbackError) {
              throw new AggregateError(
                [historyError, rollbackError],
                'History commit and view rollback failed',
              );
            }
            throw historyError;
          }
          const previous = view,
            previousLocation = committed;
          view = candidate;
          candidate = undefined;
          committed = to;
          committedEntry = entry;
          batch(() => {
            current.set(to);
            nav.finish(
              redirects.length
                ? { status: 'redirected', to, redirects: Object.freeze([...redirects]) }
                : { status: 'committed', to },
            );
          });
          if (previous)
            try {
              previous.dispose();
            } catch (cleanupError) {
              report(
                routeError(
                  previousLocation?.name ?? previousLocation?.path ?? 'previous-view',
                  'previous view cleanup',
                  cleanupError,
                ),
                nav.id,
              );
            }
        });
        return;
      }
    } catch (cause) {
      if (!valid(nav)) return;
      let failure = routeError(nav.to?.name ?? nav.to?.path ?? 'navigation', phase, cause);
      if (candidate) {
        const abandoned = candidate;
        candidate = undefined;
        try {
          abandoned.dispose();
        } catch (cleanupError) {
          failure = new RouteError(
            nav.to?.name ?? nav.to?.path ?? 'navigation',
            'candidate cleanup',
            new AggregateError([failure, cleanupError]),
          );
        }
      }

      try {
        await rejectNavigation(nav, { status: 'failed', error: failure });
      } catch (restoreError) {
        failure = new RouteError(
          nav.to?.name ?? nav.to?.path ?? 'navigation',
          'history restore',
          new AggregateError([failure, restoreError]),
        );
        if (valid(nav)) finishFailure(nav, failure);
      }
    } finally {
      if (candidate)
        try {
          candidate.dispose();
        } catch (cleanupError) {
          report(
            routeError(
              nav.to?.name ?? nav.to?.path ?? 'navigation',
              'candidate cleanup',
              cleanupError,
            ),
            nav.id,
          );
        }
    }
  }
  function start(
    target: RouteTarget,
    mode: Navigation['mode'],
    entry?: HistoryEntry,
  ): Promise<NavigationResult> {
    if (disposed) return Promise.resolve({ status: 'cancelled' });
    return new Promise((resolve) => {
      const previous = active,
        nav: Navigation = {
          id: ++sequence,
          live: true,
          mode,
          ...(entry ? { entry } : {}),
          token: new Cancellation(),
          finish(result) {
            if (!nav.live) return;
            nav.live = false;
            if (active === nav) {
              active = undefined;
              pending.set(null);
            }
            resolve(Object.freeze(result));
          },
          cancel() {
            if (!nav.live) return;
            nav.finish({ status: 'cancelled' });
            try {
              nav.token.cancel(new Error('Navigation cancelled'));
            } catch (cause) {
              report(
                routeError(nav.to?.name ?? nav.to?.path ?? 'navigation', 'cancel', cause),
                nav.id,
              );
            }
          },
        };
      active = nav;
      batch(() => {
        error.set(null);
        pending.set(null);
      });
      previous?.cancel();
      if (valid(nav)) void run(nav, target);
    });
  }
  const stop = options.history.listen((entry) => {
    if (traversal?.started && !traversal.result && traversal.intent !== sequence) {
      traversal.entry = entry;
      traversal.result = Promise.resolve({ status: 'cancelled' });
      return;
    }
    const result = start(entry.fullPath, 'pop', entry);
    if (traversal && !traversal.result) {
      traversal.result = result;
      traversal.entry = entry;
    }
  });
  return Object.freeze({
    current: readonly(current),
    pending: readonly(pending),
    error: readonly(error),
    resolve: matcher.resolve,
    href(target: RouteTarget<R>) {
      if (disposed) throw new RouteError('router', 'href', new Error('Router is disposed'));
      const fullPath = matcher.resolve(target).fullPath;
      return options.history.createHref?.(fullPath) ?? fullPath;
    },
    preload(
      target: RouteTarget<R>,
      preloadOptions: RoutePreloadOptions = {},
    ): Promise<RoutePreloadResult> {
      if (disposed) return Promise.resolve({ status: 'cancelled' });
      return new Promise((resolve) => {
        let live = true;
        let to: RouteLocation | undefined;
        const finish = (result: RoutePreloadResult): void => {
          if (!live) return;
          live = false;
          preloads.delete(cancel);
          resolve(result);
        };
        const cancel = () => finish({ status: 'cancelled' });
        preloads.add(cancel);
        void (async () => {
          to = matcher.resolve(target);
          const records = getRouteRecords(to);
          if (records.some((record) => record.redirect !== undefined)) {
            finish({ status: 'skipped', reason: 'redirect' });
            return;
          }
          const trigger = preloadOptions.trigger;
          if (trigger !== undefined) {
            if (trigger !== 'intent' && trigger !== 'idle')
              throw new Error('Unknown preload trigger');
            if (
              globalGuards.length > 0 ||
              records.some(
                (record) =>
                  (record.guards?.length ?? 0) > 0 ||
                  (Object.hasOwn(record.meta ?? {}, 'access') && record.meta!.access !== 'public'),
              )
            ) {
              finish({ status: 'skipped', reason: 'protected' });
              return;
            }
            if (records.at(-1)?.preload !== trigger) {
              finish({ status: 'skipped', reason: 'policy' });
              return;
            }
          }
          for (const record of records) {
            await modules.load(record);
            if (!live || disposed) return;
          }
          finish({ status: 'loaded', to });
        })().catch((cause) =>
          finish({
            status: 'failed',
            error: routeError(to?.name ?? to?.path ?? 'preload', 'preload', cause),
          }),
        );
      });
    },
    push: (target: RouteTarget<R>) => start(target, 'push'),
    replace: (target: RouteTarget<R>) => start(target, 'replace'),
    async back(): Promise<NavigationResult> {
      if (disposed || traversal) return { status: 'cancelled' };
      const request: {
        intent: number;
        started: boolean;
        result?: Promise<NavigationResult>;
        entry?: HistoryEntry;
      } = { intent: ++sequence, started: false };
      active?.cancel();
      error.set(null);
      traversal = request;
      try {
        const movement = historyTail.then(() => {
          if (disposed || sequence !== request.intent) return null;
          request.started = true;
          return options.history.go(-1);
        });
        historyTail = movement.catch(() => {});
        const entry = await movement;
        if (!entry || disposed) return { status: 'cancelled' };
        if (!request.result || !request.entry || !sameEntry(request.entry, entry))
          throw new Error('HistoryDriver.go must notify its resulting pop entry');
        return await request.result;
      } catch (cause) {
        if (disposed) return { status: 'cancelled' };
        const failure = routeError('history', 'back', cause);
        report(failure, sequence);
        return { status: 'failed', error: failure };
      } finally {
        if (traversal === request) traversal = undefined;
      }
    },
    invalidate() {
      if (disposed) return;
      ++sequence;
      active?.cancel();
      const previous = view,
        previousLocation = committed;
      view = undefined;
      committed = null;
      batch(() => {
        current.set(null);
        error.set(null);
      });
      try {
        previous?.dispose();
      } catch (cause) {
        const failure = routeError(
          previousLocation?.name ?? previousLocation?.path ?? 'router',
          'invalidate',
          cause,
        );
        error.set(diagnostic(failure));
        notify(failure);
        throw failure;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active?.cancel();
      for (const cancel of [...preloads]) cancel();
      modules.dispose();
      const failures: unknown[] = [];
      for (const cleanup of [stop, () => view?.dispose(), () => options.history.dispose()])
        try {
          cleanup();
        } catch (cause) {
          failures.push(cause);
        }
      view = undefined;
      if (failures.length) {
        const failure = new RouteError('router', 'dispose', new AggregateError(failures));
        notify(failure);
        throw failure;
      }
    },
  });
}
