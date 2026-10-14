import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import { AssetCache } from '@xiaobaibaifqy/jingchuanchu-assets';

test('asset cache shares loads, evicts failures and releases resources', async () => {
  let loads = 0;
  const released: string[] = [];
  const cache = new AssetCache(
    async (url: string) => {
      loads++;
      if (loads === 1) throw new Error('load failed');
      return url;
    },
    (asset) => {
      released.push(asset);
    },
  );
  await assert.rejects(cache.get('image'));
  const one = cache.get('image');
  const two = cache.get('image');
  assert.equal(one, two);
  assert.equal(await one, 'image');
  assert.equal(loads, 2);
  cache.dispose();
  await Promise.resolve();
  assert.deepEqual(released, ['image']);
  await assert.rejects(cache.get('next'));
});

test('retained resources survive clear; late loads release exactly once and report cleanup errors', async () => {
  let complete!: (value: string) => void;
  let signal!: CancellationSignal;
  const released: string[] = [];
  const cache = new AssetCache(
    (_, abort) => {
      signal = abort;
      return new Promise<string>((resolve) => {
        complete = resolve;
      });
    },
    (asset) => {
      released.push(asset);
    },
  );
  const held = cache.retain('image');
  assert.equal(cache.getStatus('image'), 'loading');
  cache.clear();
  assert.equal(signal.aborted, false);
  assert.equal(cache.delete('image'), false);
  held.release();
  held.release();
  assert.equal(signal.aborted, true);
  complete('late');
  await held.promise;
  await Promise.resolve();
  assert.deepEqual(released, ['late']);
  cache.dispose();
  const broken = new AssetCache(
    async () => 42,
    () => {
      throw new Error('release');
    },
  );
  await broken.get('x');
  broken.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(broken.releaseErrors.length, 1);
});

test('clearing a load tolerates a synchronous cancellation retry without looping', async () => {
  let cache!: AssetCache<string>;
  let attempts = 0;
  const releases: string[] = [];
  cache = new AssetCache(
    async (url, signal) => {
      attempts++;
      if (attempts === 1)
        signal.subscribe(() => {
          void cache.get(url);
        });
      return url;
    },
    (value) => releases.push(value),
  );
  const first = cache.get('image');
  cache.clear();
  await first;
  await cache.get('image');
  assert.equal(attempts, 2);
  cache.dispose();
  await Promise.resolve();
  assert.deepEqual(releases, ['image', 'image']);
});
