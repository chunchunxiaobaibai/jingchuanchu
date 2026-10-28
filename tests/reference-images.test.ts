import assert from 'node:assert/strict';
import test from 'node:test';
import { Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import { createImageTransport } from '../templates/browser/src/app/image-transport.js';
import type { AssetImage } from '@xiaobaibaifqy/jingchuanchu-app/application';

function fixture() {
  let src = '';
  const image = {
    naturalWidth: 48,
    naturalHeight: 24,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    get src() {
      return src;
    },
    set src(value: string) {
      src = value;
    },
  };
  let creations = 0;
  const transport = createImageTransport(() => {
    creations++;
    return image as unknown as HTMLImageElement;
  });
  return { image, transport, creations: () => creations };
}

test('reference image transport is lazy, returns the decoded dimensions and releases image handlers/source', async () => {
  const f = fixture(),
    signal = new Cancellation(),
    entry = { kind: 'image' as const, url: '/icon.svg' };
  assert.equal(f.creations(), 0);
  const loading = Promise.resolve(f.transport.load(entry, signal));
  assert.equal(f.image.src, '/icon.svg');
  f.image.onload!();
  const result = (await loading) as AssetImage;
  assert.equal(result.source, f.image);
  assert.equal(result.width, 48);
  assert.equal(result.height, 24);
  assert.equal(f.image.onload, null);
  assert.equal(f.image.onerror, null);
  signal.cancel();
  assert.equal(f.image.src, '/icon.svg');
  await f.transport.release!(entry, result);
  assert.equal(f.image.src, '');
});

test('reference image failure and cancellation reject and detach late image callbacks', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(),
      signal = new Cancellation();
    const pending = Promise.resolve(
      f.transport.load({ kind: 'atlas', url: '/icons.svg', frames: {} }, signal),
    );
    const rejected = assert.rejects(pending, cancel ? /cancelled by page/ : /Image failed/);
    const lateLoad = f.image.onload!;
    if (cancel) signal.cancel(new Error('cancelled by page'));
    else f.image.onerror!();
    await rejected;
    assert.equal(f.image.src, '');
    assert.equal(f.image.onload, null);
    assert.equal(f.image.onerror, null);
    lateLoad();
    assert.equal(f.image.src, '');
  }
});
