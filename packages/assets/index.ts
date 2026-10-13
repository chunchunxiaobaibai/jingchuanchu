/** Promise caching coalesces parallel loads; failed loads can be retried. */
export class AssetCache<T> {
  private readonly entries = new Map<string, Promise<T>>();
  private closed = false;
  constructor(
    private readonly load: (url: string) => Promise<T>,
    private readonly release: (asset: T) => void = () => {},
  ) {}
  get(url: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Asset cache is disposed'));
    const existing = this.entries.get(url);
    if (existing) return existing;
    const pending = this.load(url).catch((error) => {
      if (this.entries.get(url) === pending) this.entries.delete(url);
      throw error;
    });
    this.entries.set(url, pending);
    return pending;
  }
  clear(): void {
    for (const entry of this.entries.values()) void entry.then(this.release, () => {});
    this.entries.clear();
  }
  dispose(): void {
    this.closed = true;
    this.clear();
  }
}
