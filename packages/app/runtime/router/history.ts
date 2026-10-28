import { parseRoutePath } from './matcher.js';
import { RouteError, type HistoryDriver, type HistoryEntry } from './types.js';
/** Deterministic injected history; push/replace/restore are silent and go emits a pop notification. */
export function createMemoryHistoryDriver(initial = '/'): HistoryDriver {
  const entries: HistoryEntry[] = [
      Object.freeze({ fullPath: parseRoutePath(initial).fullPath, position: 0 }),
    ],
    listeners = new Set<(entry: HistoryEntry) => void>();
  let index = 0,
    disposed = false;
  const assertOpen = () => {
    if (disposed)
      throw new RouteError('history', 'access', new Error('History driver is disposed'));
  };
  return Object.freeze({
    read() {
      assertOpen();
      return entries[index]!;
    },
    push(path: string) {
      assertOpen();
      const entry = Object.freeze({ fullPath: parseRoutePath(path).fullPath, position: index + 1 });
      entries.splice(index + 1);
      entries.push(entry);
      index++;
      return entry;
    },
    replace(path: string) {
      assertOpen();
      const entry = Object.freeze({ fullPath: parseRoutePath(path).fullPath, position: index });
      entries[index] = entry;
      return entry;
    },
    async go(delta: number) {
      assertOpen();
      if (!Number.isInteger(delta))
        throw new RouteError('history', 'go', new Error('History delta must be an integer'));
      const destination = index + delta;
      if (delta === 0 || destination < 0 || destination >= entries.length) return null;
      index = destination;
      const entry = entries[index]!,
        errors: unknown[] = [];
      for (const listener of [...listeners])
        try {
          listener(entry);
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) throw new RouteError('history', 'pop', new AggregateError(errors));
      return entry;
    },
    async restore(entry: HistoryEntry) {
      assertOpen();
      if (
        !Number.isInteger(entry.position) ||
        entries[entry.position]?.fullPath !== parseRoutePath(entry.fullPath).fullPath
      )
        throw new RouteError(
          'history',
          'restore',
          new Error('History entry is no longer available'),
        );
      index = entry.position;
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
      listeners.clear();
      entries.splice(0);
    },
  });
}
