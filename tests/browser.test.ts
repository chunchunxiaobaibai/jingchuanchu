import { test } from 'node:test';
import assert from 'node:assert/strict';
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
