import type { AssetTransport } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createImageTransport } from './image-transport.js';

/** Small reference-game transport; image decoding and audio bytes use the same owner cancellation. */
export function createBrowserAssetTransport(
  fetchResource: typeof fetch = (...args) => fetch(...args),
  images = createImageTransport(),
): AssetTransport {
  return {
    async load(entry, signal) {
      if (entry.kind !== 'audio') return images.load(entry, signal);
      signal.throwIfAborted();
      const cancellation = new AbortController();
      const unsubscribe = signal.subscribe(() => cancellation.abort(signal.reason));
      try {
        const response = await fetchResource(entry.url, { signal: cancellation.signal });
        if (!response.ok)
          throw new Error(`Audio request failed (${response.status}): ${entry.url}`);
        const bytes = await response.arrayBuffer();
        signal.throwIfAborted();
        return bytes;
      } finally {
        unsubscribe();
      }
    },
    release(entry, raw) {
      if (entry.kind !== 'audio') return images.release?.(entry, raw);
    },
  };
}
