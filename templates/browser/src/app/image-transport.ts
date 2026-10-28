import type { AssetTransport, AssetImage } from '@xiaobaibaifqy/jingchuanchu-app/application';

/** Browser image transport; no image/network activity before an explicit asset load. */
export function createImageTransport(createImage = () => new Image()): AssetTransport {
  return {
    load(entry, signal) {
      signal.throwIfAborted();
      if (entry.kind !== 'image' && entry.kind !== 'atlas')
        return Promise.reject(new Error(`Image transport cannot load ${entry.kind}`));
      return new Promise<AssetImage>((resolve, reject) => {
        const image = createImage();
        let unsubscribe = () => {},
          done = false;
        const finish = (error?: unknown) => {
          if (done) return;
          done = true;
          unsubscribe();
          image.onload = image.onerror = null;
          if (error !== undefined) {
            image.src = '';
            reject(error);
          } else resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onload = () => finish();
        image.onerror = () => finish(new Error(`Image failed: ${entry.url}`));
        unsubscribe = signal.subscribe(() =>
          finish(signal.reason ?? new Error('Image load cancelled')),
        );
        if (!done) image.src = entry.url;
      });
    },
    release(entry, raw) {
      if (entry.kind === 'image' || entry.kind === 'atlas')
        (raw as { source: HTMLImageElement }).source.src = '';
    },
  };
}
