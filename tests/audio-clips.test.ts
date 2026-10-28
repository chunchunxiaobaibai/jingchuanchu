import assert from 'node:assert/strict';
import test from 'node:test';
import { Cancellation, Scope, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineAssetGroup,
  AudioError,
  type AudioDriver,
  type DecodedAudio,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AssetService } from '../packages/app/runtime/asset-service.js';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { AudioClipCache } from '../packages/app/runtime/audio-clips.js';
const Group = defineAssetGroup({
  name: 'game-audio',
  entries: { tone: { kind: 'audio', url: '/tone.bin' } },
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(decode: AudioDriver['decode']) {
  const owner = new ComponentOwner(),
    scope = new Scope();
  const data = new ArrayBuffer(4);
  let loads = 0,
    rawReleased = 0,
    decodedReleased = 0;
  const errors: AudioError[] = [];
  const assets = new AssetService(
    {
      transport: () => ({
        async load() {
          loads++;
          return data;
        },
        release() {
          rawReleased++;
        },
      }),
    },
    (error) => {
      throw error;
    },
  );
  owner.scope.own(() => assets.dispose());
  const driver: AudioDriver = {
    unlock: async () => 'ready',
    decode,
    start() {
      throw new Error('Playback not part of clip cache');
    },
    release() {
      decodedReleased++;
    },
    close() {},
  };
  const clips = new AudioClipCache(driver, scope, (error) => {
    errors.push(error);
  });
  return {
    owner,
    scope,
    data,
    errors,
    clips,
    assets: assets.forOwner(owner),
    stats: () => ({ loads, rawReleased, decodedReleased }),
  };
}

test('shared raw audio decodes once with owned bytes; cancelling one waiter preserves the other and last release retires both references', async () => {
  let decodes = 0,
    finish!: (clip: DecodedAudio) => void,
    driverSignal: CancellationSignal | undefined,
    decodedBytes: ArrayBuffer | undefined;
  const f = fixture((bytes, signal) => {
    decodes++;
    driverSignal = signal;
    decodedBytes = bytes;
    new Uint8Array(bytes)[0] = 7;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const a = new Cancellation(),
    b = new Cancellation();
  const first = f.clips.load(f.assets, Group, 'tone', a).then(
    () => null,
    (error) => error,
  );
  const second = f.clips.load(f.assets, Group, 'tone', b);
  await settle();
  assert.equal(decodes, 1);
  assert.equal(f.stats().loads, 1);
  assert.notEqual(decodedBytes, f.data);
  assert.equal(new Uint8Array(f.data)[0], 0);
  a.cancel();
  assert.ok((await first) instanceof AudioError);
  assert.equal(driverSignal!.aborted, false);
  const decoded = { duration: 1 };
  finish(decoded);
  const lease = await second;
  assert.equal(lease.decoded, decoded);
  assert.equal(f.stats().decodedReleased, 0);
  lease.release();
  lease.release();
  await settle();
  assert.deepEqual(f.stats(), { loads: 1, rawReleased: 1, decodedReleased: 1 });
  assert.throws(() => lease.decoded, AudioError);
  assert.equal(f.errors.length, 0);
  f.scope.dispose();
  f.owner.dispose();
});

test('failed decode reports group/key/cause, releases the raw lease and permits a fresh retry', async () => {
  let fail = true,
    decodes = 0;
  const cause = new Error('bad encoding');
  const f = fixture(async () => {
    decodes++;
    if (fail) throw cause;
    return { duration: 1 };
  });
  const signal = new Cancellation();
  await assert.rejects(
    f.clips.load(f.assets, Group, 'tone', signal),
    (error: unknown) =>
      error instanceof AudioError &&
      error.group === 'game-audio' &&
      error.key === 'tone' &&
      error.operation === 'decode' &&
      error.cause === cause,
  );
  await settle();
  assert.equal(f.stats().rawReleased, 1);
  fail = false;
  const lease = await f.clips.load(f.assets, Group, 'tone', signal);
  assert.equal(decodes, 2);
  lease.release();
  await settle();
  assert.equal(f.stats().decodedReleased, 1);
  f.scope.dispose();
  f.owner.dispose();
});

test('cache exit settles decode waiting immediately and reclaims an ignored late result exactly once', async () => {
  let finish!: (clip: DecodedAudio) => void;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = f.clips.load(f.assets, Group, 'tone', new Cancellation()).then(
    () => false,
    (error) => error,
  );
  await settle();
  f.scope.dispose();
  assert.ok((await result) instanceof AudioError);
  finish({ duration: 1 });
  await settle();
  assert.deepEqual(f.stats(), { loads: 1, rawReleased: 1, decodedReleased: 1 });
  f.clips.dispose();
  f.owner.dispose();
  assert.equal(f.stats().decodedReleased, 1);
  assert.equal(f.errors.length, 0);
});
