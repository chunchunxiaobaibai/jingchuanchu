import assert from 'node:assert/strict';
import test from 'node:test';
import { defineAssetGroup, AssetError } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { decodeAssetEntry } from '../packages/app/runtime/assets.js';
import type { AssetEntries } from '../packages/app/runtime/asset-types.js';

test('asset definitions snapshot atlas frames, preserve decoder identity and reject invalid declarations with their source', () => {
  const parse = (raw: unknown) => Number(raw);
  const frames = { coin: { x: 0, y: 0, width: 16, height: 16 } };
  const group = defineAssetGroup({
    name: 'game',
    entries: {
      image: { kind: 'image', url: '/coin.png' },
      sheet: { kind: 'atlas', url: '/sheet.png', frames },
      score: { kind: 'json', url: '/score.json', parse },
    },
  });
  frames.coin.width = 100;
  assert.equal(group.entries.sheet.frames.coin.width, 16);
  assert.equal(group.entries.score.parse, parse);
  assert.ok(Object.isFrozen(group.entries.sheet.frames.coin));
  for (const entry of [
    { kind: 'json', url: '/bad.json' },
    { kind: 'image', url: '' },
    { kind: 'atlas', url: '/bad.png', frames: { bad: { x: -1, y: 0, width: 4, height: 4 } } },
    { kind: 'atlas', url: '/bad.png', frames: { bad: { x: 0, y: 0, width: 1.5, height: 4 } } },
  ])
    assert.throws(
      () => defineAssetGroup({ name: 'invalid', entries: { broken: entry } as AssetEntries }),
      (error) =>
        error instanceof AssetError &&
        error.group === 'invalid' &&
        error.key === 'broken' &&
        error.operation === 'define',
    );
});

test('JSON decoders enforce validation, synchronous plain data and immutable decoded snapshots', async () => {
  const parse = (raw: unknown) => {
    const value = raw as { levels?: unknown } | null;
    if (!value || !Array.isArray(value.levels) || !value.levels.every((n) => typeof n === 'number'))
      throw new Error('levels must be numbers');
    return { levels: value.levels as number[] };
  };
  const group = defineAssetGroup({
    name: 'levels',
    entries: { config: { kind: 'json', url: '/levels.json', parse } },
  });
  const raw = { levels: [1, 2] };
  const value = decodeAssetEntry(group, 'config', raw);
  raw.levels.push(3);
  assert.deepEqual(value.levels, [1, 2]);
  assert.ok(Object.isFrozen(value.levels));
  assert.throws(
    () => decodeAssetEntry(group, 'config', { levels: ['bad'] }),
    (error) =>
      error instanceof AssetError &&
      error.url === '/levels.json' &&
      error.operation === 'decode' &&
      error.cause instanceof Error,
  );
  const invalid = defineAssetGroup({
    name: 'invalid',
    entries: { date: { kind: 'json', url: '/date.json', parse: () => new Date() } },
  });
  assert.throws(() => decodeAssetEntry(invalid, 'date', null), /plain objects/);
  const asyncDecoder = defineAssetGroup({
    name: 'async',
    entries: {
      data: {
        kind: 'json',
        url: '/async.json',
        parse: () => Promise.reject(new Error('late decoder error')),
      },
    } as AssetEntries,
  });
  assert.throws(() => decodeAssetEntry(asyncDecoder, 'data', null), /must be synchronous/);
  await new Promise<void>((done) => setImmediate(done));
});

test('image/atlas decoding preserves the live source, validates frame bounds and audio requires real bytes', () => {
  const source = {} as CanvasImageSource;
  const raw = { source, width: 32, height: 16 };
  const group = defineAssetGroup({
    name: 'visuals',
    entries: {
      picture: { kind: 'image', url: '/picture.png' },
      sheet: {
        kind: 'atlas',
        url: '/sheet.png',
        frames: { coin: { x: 16, y: 0, width: 16, height: 16 } },
      },
      audio: { kind: 'audio', url: '/sound.ogg', optional: true },
    },
  });
  const image = decodeAssetEntry(group, 'picture', raw),
    atlas = decodeAssetEntry(group, 'sheet', raw);
  assert.equal(image.source, source);
  assert.equal(atlas.image.source, source);
  assert.equal(Object.isFrozen(source), false);
  raw.width = 1;
  assert.equal(image.width, 32);
  assert.throws(() => decodeAssetEntry(group, 'sheet', raw), /exceeds image/);
  assert.throws(
    () => decodeAssetEntry(group, 'picture', { source, width: 0, height: 1 }),
    /positive integer/,
  );
  const bytes = new ArrayBuffer(4);
  assert.equal(decodeAssetEntry(group, 'audio', bytes), bytes);
  assert.throws(() => decodeAssetEntry(group, 'audio', new Uint8Array(4)), AssetError);
});
