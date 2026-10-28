import { AssetCache } from '@xiaobaibaifqy/jingchuanchu-assets';
import type { CancellationSignal, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { decodeAssetEntry } from './assets.js';
import {
  ASSET_GROUP,
  AssetError,
  type AssetGroup,
  type AssetEntries,
  type AssetEntry,
  type AssetTransport,
  type AssetGroupProgress,
  type AssetGroupLease,
  type AssetLoadOptions,
  type AssetValue,
} from './asset-types.js';

interface Request {
  group: AssetGroup<AssetEntries>;
  key: string;
  entry: AssetEntry;
}
interface Resource {
  request: Request;
  entry: AssetEntry;
  raw: unknown;
  value: unknown;
}
interface Job {
  request: Request;
  signal: CancellationSignal;
  started: boolean;
  cancelled: boolean;
  off: Cleanup | undefined;
  resolve(value: Resource): void;
  reject(error: unknown): void;
}
export interface AssetBatch<E extends AssetEntries = AssetEntries> {
  readonly ready: Promise<AssetGroupLease<E>>;
  release(): void;
}

/** Internal shared transport pool. Public leases/owner integration follow in T18. */
export class AssetLoader {
  private readonly cache: AssetCache<Resource>;
  private readonly requests = new Map<string, Request>();
  private readonly decoders = new WeakMap<object, number>();
  private nextDecoder = 0;
  private readonly queue: Job[] = [];
  private readonly batches = new Set<Cleanup>();
  private active = 0;
  private closed = false;
  private readonly concurrency: number;
  constructor(
    private readonly transport: AssetTransport,
    options: {
      concurrency?: number;
      onReleaseError?: (error: unknown) => void;
    } = {},
  ) {
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1)
      throw new Error('Asset concurrency must be a positive integer');
    this.cache = new AssetCache(
      (key, signal) => this.enqueue(this.requests.get(key)!, signal),
      async (resource) => {
        try {
          await this.transport.release?.(resource.entry, resource.raw);
        } catch (error) {
          throw new AssetError(
            resource.request.group.name,
            resource.request.key,
            resource.entry.url,
            'release',
            error,
          );
        }
      },
      options,
    );
  }
  private parsedKey(entry: AssetEntry): string {
    let decoder: number | string = 0;
    if (entry.kind === 'json') {
      decoder = this.decoders.get(entry.parse) ?? ++this.nextDecoder;
      this.decoders.set(entry.parse, decoder);
    } else if (entry.kind === 'atlas')
      decoder = JSON.stringify(Object.entries(entry.frames).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify([entry.kind, entry.url, decoder]);
  }
  private enqueue(request: Request, signal: CancellationSignal): Promise<Resource> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Asset loader is disposed'));
        return;
      }
      const job: Job = {
        request,
        signal,
        resolve,
        reject,
        started: false,
        cancelled: false,
        off: undefined,
      };
      job.off = signal.subscribe(() => {
        if (job.started || job.cancelled) return;
        job.cancelled = true;
        job.off?.();
        reject(signal.reason ?? new Error('Asset load cancelled'));
      });
      this.queue.push(job);
      this.drain();
    });
  }
  private drain(): void {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.cancelled) continue;
      job.started = true;
      job.off?.();
      this.active++;
      void this.execute(job.request, job.signal)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
  private async execute(request: Request, signal: CancellationSignal): Promise<Resource> {
    signal.throwIfAborted();
    const raw = await this.transport.load(request.entry, signal);
    try {
      signal.throwIfAborted();
      const value = decodeAssetEntry(request.group, request.key, raw);
      return { request, entry: request.entry, raw, value };
    } catch (error) {
      try {
        await this.transport.release?.(request.entry, raw);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Asset decode and cleanup failed');
      }
      throw error;
    }
  }
  retain<E extends AssetEntries>(group: AssetGroup<E>, key: keyof E & string) {
    if (this.closed) throw new Error('Asset loader is disposed');
    if (group[ASSET_GROUP] !== true) throw new Error('Expected defineAssetGroup(...)');
    const entry = group.entries[key] as AssetEntry | undefined;
    if (!entry) throw new AssetError(group.name, key, '', 'load', new Error('Unknown asset key'));
    const parsed = this.parsedKey(entry);
    if (!this.requests.has(parsed))
      this.requests.set(parsed, { group: group as AssetGroup<AssetEntries>, key, entry });
    const held = this.cache.retain(parsed);
    return {
      promise: held.promise
        .then((resource) => resource.value)
        .catch((error) => {
          throw new AssetError(
            group.name,
            key,
            entry.url,
            error instanceof AssetError ? error.operation : 'load',
            error instanceof AssetError ? error.cause : error,
          );
        }),
      release: () => {
        held.release();
        if (this.cache.getStatus(parsed) === 'idle') this.requests.delete(parsed);
      },
    };
  }
  start<E extends AssetEntries>(
    group: AssetGroup<E>,
    options: AssetLoadOptions = {},
  ): AssetBatch<E> {
    if (this.closed) throw new Error('Asset loader is disposed');
    if (group[ASSET_GROUP] !== true) throw new Error('Expected defineAssetGroup(...)');
    const keys = Object.keys(group.entries),
      total = keys.length;
    const held: ReturnType<AssetLoader['retain']>[] = [];
    const values = new Map<string, unknown>(),
      failures: AssetError[] = [];
    let completed = 0,
      failed = 0,
      released = false,
      observerFailed = false;
    let phase: AssetGroupProgress['status'] = 'loading';
    let off: Cleanup | undefined;
    let resolve!: (lease: AssetGroupLease<E>) => void, reject!: (error: unknown) => void;
    const ready = new Promise<AssetGroupLease<E>>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const progress = (status: AssetGroupProgress['status']): void => {
      if ((released && status !== 'cancelled') || observerFailed) return;
      try {
        const result = options.onProgress?.(
          Object.freeze({ status, total, completed, failed, pending: total - completed - failed }),
        ) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw new Error('Progress observers must be synchronous');
        }
      } catch (error) {
        observerFailed = true;
        failures.push(new AssetError(group.name, '<group>', '', 'progress', error));
      }
    };
    const release = (): void => {
      if (released) return;
      released = true;
      this.batches.delete(release);
      off?.();
      off = undefined;
      values.clear();
      const errors: unknown[] = [];
      for (const reference of held.splice(0)) {
        try {
          reference.release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (phase === 'loading') {
        phase = 'cancelled';
        progress('cancelled');
        const reason = options.signal?.reason ?? new Error('Asset batch released before ready');
        reject(
          new AssetError(
            group.name,
            '<group>',
            '',
            'cancel',
            errors.length ? new AggregateError([reason, ...errors]) : reason,
          ),
        );
      }
      if (errors.length) throw new AggregateError(errors, 'Asset batch release failed');
    };
    const lease: AssetGroupLease<E> = Object.freeze({
      get<K extends keyof E & string>(key: K): AssetValue<E[K]> {
        const entry = group.entries[key] as AssetEntry | undefined;
        if (!entry || released)
          throw new AssetError(
            group.name,
            key,
            entry?.url ?? '',
            'read',
            new Error(released ? 'Asset lease is released' : 'Unknown asset key'),
          );
        return values.get(key) as AssetValue<E[K]>;
      },
      release,
    });
    this.batches.add(release);
    off = options.signal?.subscribe(release);
    if (!released) progress('loading');
    const settled = released
      ? []
      : keys.map(async (key) => {
          if (released) return;
          try {
            const reference = this.retain(group, key);
            // A synchronous adapter may cancel the group before retain returns.
            if (released) reference.release();
            else held.push(reference);
            const value = await reference.promise;
            if (released) return;
            values.set(key, value);
            completed++;
          } catch (error) {
            if (released) return;
            failed++;
            if (!group.entries[key]!.optional)
              failures.push(
                error instanceof AssetError
                  ? error
                  : new AssetError(group.name, key, group.entries[key]!.url, 'load', error),
              );
          }
          progress('loading');
        });
    void Promise.all(settled).then(() => {
      if (released) return;
      progress(failures.length ? 'failed' : 'ready');
      if (released) return;
      phase = failures.length ? 'failed' : 'ready';
      if (failures.length)
        reject(
          failures.length === 1
            ? failures[0]
            : new AggregateError(failures, `Asset group ${group.name} failed`),
        );
      else resolve(lease);
    });
    return { ready, release };
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const release of [...this.batches]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.cache.dispose();
    } catch (error) {
      errors.push(error);
    }
    this.requests.clear();
    this.queue.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Asset loader disposal failed');
  }
}
