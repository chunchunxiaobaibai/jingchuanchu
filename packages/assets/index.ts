import { Cancellation, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
export type AssetStatus = 'idle' | 'loading' | 'ready' | 'failed';
interface Entry<T> {
  promise: Promise<T>;
  controller: Cancellation;
  status: AssetStatus;
  references: number;
  removed: boolean;
}
/** Promise caching coalesces parallel loads; failed loads can be retried. */
export class AssetCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private closed = false;
  readonly releaseErrors: unknown[] = [];
  constructor(
    private readonly load: (url: string, signal: CancellationSignal) => Promise<T>,
    private readonly release: (asset: T) => void = () => {},
    private readonly options: { onReleaseError?: (error: unknown) => void } = {},
  ) {}
  get(url: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Asset cache is disposed'));
    const existing = this.entries.get(url);
    if (existing && existing.status !== 'failed') return existing.promise;
    const entry: Entry<T> = {
      promise: undefined as unknown as Promise<T>,
      controller: new Cancellation(),
      status: 'loading',
      references: 0,
      removed: false,
    };
    this.entries.set(url, entry);
    try {
      entry.promise = Promise.resolve(this.load(url, entry.controller));
    } catch (error) {
      entry.promise = Promise.reject(error);
    }
    entry.promise = entry.promise.then(
      (asset) => {
        entry.status = 'ready';
        return asset;
      },
      (error) => {
        entry.status = 'failed';
        throw error;
      },
    );
    return entry.promise;
  }
  getStatus(url: string): AssetStatus {
    return this.entries.get(url)?.status ?? 'idle';
  }
  retain(url: string): { promise: Promise<T>; release(): void } {
    const promise = this.get(url);
    const entry = this.entries.get(url);
    if (entry && !this.closed) entry.references++;
    let released = false;
    return {
      promise,
      release: () => {
        if (released) return;
        released = true;
        if (entry && !entry.removed) {
          entry.references--;
          if (entry.references === 0 && this.entries.get(url) === entry) this.delete(url);
        }
      },
    };
  }
  delete(url: string): boolean {
    const entry = this.entries.get(url);
    if (!entry || entry.references > 0) return false;
    this.entries.delete(url);
    this.remove(entry);
    return true;
  }
  clear(): void {
    for (const [url, entry] of this.entries)
      if (this.closed || entry.references === 0) {
        this.entries.delete(url);
        this.remove(entry);
      }
  }
  dispose(): void {
    this.closed = true;
    this.clear();
  }
  private remove(entry: Entry<T>): void {
    if (entry.removed) return;
    entry.removed = true;
    try {
      entry.controller.cancel();
    } catch (error) {
      this.reportReleaseError(error);
    }
    void entry.promise
      .then(
        (asset) => this.release(asset),
        () => {},
      )
      .catch((error) => this.reportReleaseError(error));
  }
  private reportReleaseError(error: unknown): void {
    this.releaseErrors.push(error);
    try {
      this.options.onReleaseError?.(error);
    } catch (callbackError) {
      this.releaseErrors.push(callbackError);
    }
  }
}
