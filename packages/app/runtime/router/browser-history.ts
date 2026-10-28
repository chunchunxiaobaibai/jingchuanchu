import { parseRoutePath } from './matcher.js';
import { RouteError, type HistoryDriver, type HistoryEntry } from './types.js';
import { reportApplicationError } from '../errors.js';
export interface BrowserHistoryHost {
  readonly location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  readonly history: Pick<History, 'state' | 'replaceState' | 'pushState' | 'go'>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
interface Stamp {
  version: 1;
  scope: string;
  session: string;
  position: number;
  max: number;
  fullPath: string;
}
const STATE = '__jingchuanchu_router__',
  FOREIGN = '__jingchuanchu_foreign_state__';
const windows = new WeakSet<object>();
const same = (a: HistoryEntry, b: HistoryEntry) =>
  a.position === b.position && a.fullPath === b.fullPath;
function stamp(value: unknown): Stamp | undefined {
  if (!value || typeof value !== 'object') return;
  const item = (value as Record<string, unknown>)[STATE] as Partial<Stamp> | undefined;
  if (
    item?.version === 1 &&
    typeof item.scope === 'string' &&
    typeof item.session === 'string' &&
    typeof item.fullPath === 'string' &&
    Number.isInteger(item.position) &&
    item.position! >= 0 &&
    Number.isInteger(item.max) &&
    item.max! >= item.position!
  )
    return item as Stamp;
}
function stateWith(value: unknown, entry: Stamp): Record<string, unknown> {
  const plain =
    value &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]';
  return { ...(plain ? value : { [FOREIGN]: value }), [STATE]: entry };
}
/** Owns one window's managed entries. Native mutation without its stamp is reported, never guessed. */
export function createBrowserHistoryDriver(
  options: {
    window?: BrowserHistoryHost;
    mode?: 'hash' | 'history';
    base?: string;
    onError?: (error: RouteError) => void;
  } = {},
): HistoryDriver {
  const host = options.window ?? globalThis.window;
  if (!host)
    throw new RouteError(
      'history',
      'create',
      new Error('Browser window is unavailable; inject a host'),
    );
  if (windows.has(host))
    throw new RouteError(
      'history',
      'create',
      new Error('A browser history driver already owns this window'),
    );
  const mode = options.mode ?? 'hash';
  if (!['hash', 'history'].includes(mode))
    throw new RouteError('history', 'create', new Error('Unknown browser history mode'));
  if (mode === 'hash' && options.base !== undefined)
    throw new RouteError('history', 'create', new Error('base applies only to history mode'));
  const parsedBase = parseRoutePath(options.base ?? '/'),
    base = parsedBase.path;
  if (parsedBase.fullPath !== base)
    throw new RouteError('history', 'create', new Error('base must contain only a pathname'));
  const shell = host.location.pathname + host.location.search;
  const scope = JSON.stringify([mode, mode === 'hash' ? shell : base]);
  const readPath = () => {
    if (mode === 'hash') {
      if (host.location.pathname + host.location.search !== shell)
        throw new Error('URL is outside the hash application host');
      return parseRoutePath(host.location.hash.slice(1) || '/').fullPath;
    }
    const pathname = host.location.pathname;
    if (base !== '/' && pathname !== base && !pathname.startsWith(base + '/'))
      throw new Error('URL is outside the application base');
    return parseRoutePath(
      (base === '/' ? pathname : pathname.slice(base.length) || '/') +
        host.location.search +
        host.location.hash,
    ).fullPath;
  };
  const url = (path: string) => (mode === 'hash' ? '#' + path : (base === '/' ? '' : base) + path);
  let initial: string;
  try {
    initial = readPath();
  } catch (cause) {
    throw new RouteError('history', 'create', cause);
  }
  const saved = stamp(host.history.state),
    adopt = saved?.scope === scope && saved.fullPath === initial;
  const session = adopt
    ? saved.session
    : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`);
  let current: HistoryEntry = Object.freeze({
      fullPath: initial,
      position: adopt ? saved.position : 0,
    }),
    max = adopt ? saved.max : 0,
    disposed = false,
    invalid: RouteError | undefined;
  const known = new Map<number, string>([[current.position, current.fullPath]]),
    listeners = new Set<(entry: HistoryEntry) => void>();
  let pending:
    | {
        kind: 'go' | 'restore';
        target?: HistoryEntry;
        resolve: (entry: HistoryEntry) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  const entryStamp = (entry: HistoryEntry): Stamp => ({
    version: 1,
    scope,
    session,
    position: entry.position,
    max,
    fullPath: entry.fullPath,
  });
  const assertOpen = () => {
    if (disposed)
      throw new RouteError('history', 'access', new Error('Browser history driver is disposed'));
    if (invalid) throw invalid;
    try {
      const metadata = stamp(host.history.state);
      if (
        !metadata ||
        metadata.scope !== scope ||
        metadata.session !== session ||
        metadata.fullPath !== readPath()
      )
        throw new Error(
          'Unmanaged history entry; recreate the driver to establish a new history boundary',
        );
    } catch (cause) {
      invalid = new RouteError('history', 'access', cause);
      const waiting = pending;
      pending = undefined;
      waiting?.reject(invalid);
      throw invalid;
    }
  };
  const assertIdle = () => {
    assertOpen();
    if (pending)
      throw new RouteError('history', 'write', new Error('A history traversal is still pending'));
  };
  const report = (error: RouteError) =>
    reportApplicationError(error, options.onError ? () => options.onError!(error) : undefined);
  const onChange: EventListener = () => {
    if (disposed || invalid) return;
    let next: HistoryEntry;
    const waiting = pending;
    try {
      const path = readPath(),
        metadata = stamp(host.history.state);
      if (
        !metadata ||
        metadata.scope !== scope ||
        metadata.session !== session ||
        metadata.fullPath !== path
      )
        throw new Error(
          'Unmanaged history entry; recreate the driver to establish a new history boundary',
        );
      next = Object.freeze({ fullPath: path, position: metadata.position });
      if (same(next, current)) return; // popstate/hashchange can describe the same traversal.
      if (next.position > max) max = Math.max(next.position, metadata.max);
      host.history.replaceState(
        stateWith(host.history.state, entryStamp(next)),
        '',
        url(next.fullPath),
      );
      current = next;
      known.set(next.position, next.fullPath);
      pending = undefined;
    } catch (cause) {
      invalid = new RouteError('history', 'pop', cause);
      pending = undefined;
      if (waiting) waiting.reject(invalid);
      else report(invalid);
      return;
    }
    if (waiting?.kind === 'restore') {
      if (waiting.target && same(waiting.target, next)) {
        waiting.resolve(next);
        return;
      }
      waiting.reject(
        new RouteError(
          'history',
          'restore',
          new Error('Native traversal did not reach the restoration entry'),
        ),
      );
    }
    const errors: unknown[] = [];
    for (const listener of [...listeners])
      try {
        listener(next);
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) {
      const error = new RouteError('history', 'pop listeners', new AggregateError(errors));
      if (waiting?.kind === 'go') waiting.reject(error);
      else report(error);
    } else if (waiting?.kind === 'go') waiting.resolve(next);
  };
  windows.add(host);
  try {
    host.history.replaceState(
      stateWith(host.history.state, entryStamp(current)),
      '',
      url(current.fullPath),
    );
    host.addEventListener('popstate', onChange);
    if (mode === 'hash') host.addEventListener('hashchange', onChange);
  } catch (cause) {
    host.removeEventListener('popstate', onChange);
    host.removeEventListener('hashchange', onChange);
    windows.delete(host);
    throw new RouteError('history', 'create', cause);
  }
  function traverse(
    delta: number,
    kind: 'go' | 'restore',
    target?: HistoryEntry,
  ): Promise<HistoryEntry> {
    return new Promise((resolve, reject) => {
      const operation = { kind, ...(target ? { target } : {}), resolve, reject };
      pending = operation;
      try {
        host.history.go(delta);
      } catch (cause) {
        if (pending === operation) pending = undefined;
        reject(new RouteError('history', kind, cause));
      }
    });
  }
  return Object.freeze({
    createHref(path: string) {
      assertOpen();
      return url(parseRoutePath(path).fullPath);
    },
    read() {
      assertOpen();
      return current;
    },
    push(path: string) {
      assertIdle();
      const fullPath = parseRoutePath(path).fullPath,
        entry = Object.freeze({ fullPath, position: current.position + 1 }),
        previousMax = max;
      max = entry.position;
      try {
        host.history.pushState(stateWith(host.history.state, entryStamp(entry)), '', url(fullPath));
      } catch (cause) {
        max = previousMax;
        throw new RouteError('history', 'push', cause);
      }
      for (const position of known.keys()) if (position > current.position) known.delete(position);
      known.set(entry.position, fullPath);
      current = entry;
      return entry;
    },
    replace(path: string) {
      assertIdle();
      const fullPath = parseRoutePath(path).fullPath,
        entry = Object.freeze({ fullPath, position: current.position });
      try {
        host.history.replaceState(
          stateWith(host.history.state, entryStamp(entry)),
          '',
          url(fullPath),
        );
      } catch (cause) {
        throw new RouteError('history', 'replace', cause);
      }
      known.set(entry.position, fullPath);
      current = entry;
      return entry;
    },
    async go(delta: number) {
      assertIdle();
      if (!Number.isInteger(delta))
        throw new RouteError('history', 'go', new Error('History delta must be an integer'));
      const destination = current.position + delta;
      if (!delta || destination < 0 || destination > max) return null;
      return traverse(delta, 'go');
    },
    async restore(entry: HistoryEntry) {
      assertIdle();
      if (!Number.isInteger(entry.position) || known.get(entry.position) !== entry.fullPath)
        throw new RouteError(
          'history',
          'restore',
          new Error('History entry is no longer available'),
        );
      if (same(current, entry)) return;
      await traverse(entry.position - current.position, 'restore', entry);
    },
    listen(listener: (entry: HistoryEntry) => void) {
      assertOpen();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener('popstate', onChange);
      host.removeEventListener('hashchange', onChange);
      windows.delete(host);
      listeners.clear();
      known.clear();
      const waiting = pending;
      pending = undefined;
      waiting?.reject(
        new RouteError('history', 'dispose', new Error('Browser history driver is disposed')),
      );
    },
  });
}
