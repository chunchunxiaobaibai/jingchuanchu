import type { EngineModule, CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource, type Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { AssetCache } from './index.js';

export interface AssetModule<T> extends EngineModule {
  readonly cache: Token<AssetCache<T>>;
}
export function assetModule<T>(options: {
  id?: string;
  load: (url: string, signal: CancellationSignal) => Promise<T>;
  release?: (asset: T) => void;
  onReleaseError?: (error: unknown) => void;
}): AssetModule<T> {
  const id = options.id ?? 'assets';
  const cache = resource<AssetCache<T>>(`${id}:cache`);
  return {
    id,
    cache,
    setup(engine, scope) {
      const instance = new AssetCache(options.load, options.release, options);
      engine.provide(cache, instance, scope);
      scope.own(() => instance.dispose());
    },
  };
}
