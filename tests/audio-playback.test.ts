import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineAssetGroup,
  type AudioDriver,
  type AudioVoice,
  type AudioError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AudioService } from '../packages/app/runtime/audio.js';
import { AssetService } from '../packages/app/runtime/asset-service.js';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
const Group = defineAssetGroup({
  name: 'audio-game',
  entries: {
    music: { kind: 'audio', url: '/music.bin' },
    effect: { kind: 'audio', url: '/effect.bin' },
  },
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(effectPolicy: 'drop-new' | 'drop-oldest' = 'drop-new') {
  const scope = new Scope(),
    owner = new ComponentOwner();
  let loads = 0,
    decodes = 0,
    released = 0,
    closed = 0,
    failStart = false,
    delayed = false;
  const pendingStarts = new Map<AudioVoice, (voice: AudioVoice) => void>();
  const errors: AudioError[] = [];
  const voices: {
    value: AudioVoice;
    gains: number[];
    stops: number;
    pauses: number;
    resumes: number;
    end: () => void;
    loop: boolean;
  }[] = [];
  const assets = new AssetService(
    {
      transport: () => ({
        async load() {
          loads++;
          return new ArrayBuffer(4);
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
    async decode() {
      decodes++;
      return {};
    },
    release() {
      released++;
    },
    close() {
      closed++;
    },
    start(_clip, options) {
      if (failStart) throw new Error('start failed');
      const entry = {
        value: undefined! as AudioVoice,
        gains: [options.gain],
        stops: 0,
        pauses: 0,
        resumes: 0,
        end: options.onEnded,
        loop: options.loop,
      };
      entry.value = {
        setGain(value) {
          entry.gains.push(value);
        },
        stop() {
          entry.stops++;
        },
        pause() {
          entry.pauses++;
        },
        resume() {
          entry.resumes++;
        },
      };
      voices.push(entry);
      return delayed
        ? new Promise<AudioVoice>((resolve) => {
            pendingStarts.set(entry.value, resolve);
          })
        : entry.value;
    },
  };
  const audio = new AudioService({
    scope,
    driver,
    assets: assets.forOwner(owner),
    maxEffects: 1,
    effectPolicy,
    onError: (error) => {
      errors.push(error);
    },
  });
  return {
    scope,
    owner,
    audio,
    voices,
    errors,
    stats: () => ({ loads, decodes, released, closed }),
    fail(value: boolean) {
      failStart = value;
    },
    delay() {
      delayed = true;
    },
    finish(index = voices.length - 1) {
      const value = voices[index]!.value;
      pendingStarts.get(value)!(value);
      pendingStarts.delete(value);
    },
  };
}

test('blocked audio does not load or queue; played effect applies current gains and natural completion releases its clip', async () => {
  const f = fixture();
  assert.deepEqual(await f.audio.playEffect(Group, 'effect'), {
    status: 'blocked',
    reason: 'locked',
  });
  assert.equal(f.stats().loads, 0);
  await f.audio.mixer.unlock();
  f.audio.mixer.setVolume('master', 0.5);
  f.audio.mixer.setVolume('effects', 0.4);
  const result = await f.audio.playEffect(Group, 'effect');
  assert.equal(result.status, 'played');
  assert.equal(f.voices.length, 1);
  assert.equal(f.voices[0]!.gains.at(-1), 0.2);
  assert.equal(f.voices[0]!.loop, false);
  assert.deepEqual(await f.audio.playEffect(Group, 'effect'), {
    status: 'blocked',
    reason: 'limit',
  });
  assert.equal(f.stats().loads, 2);
  f.audio.mixer.setMuted(true);
  assert.equal(f.voices[0]!.gains.at(-1), 0);
  f.voices[0]!.end();
  await settle();
  assert.equal(f.stats().released, 1);
  assert.equal(f.voices[0]!.stops, 0);
  if (result.status === 'played') assert.equal(result.playback.state, 'ended');
  f.scope.dispose();
  f.owner.dispose();
  assert.equal(f.stats().closed, 1);
});

test('music keeps the committed track when replacement fails, replaces on success and pauses independently of mute', async () => {
  const f = fixture();
  await f.audio.mixer.unlock();
  const first = await f.audio.playMusic(Group, 'music');
  assert.equal(first.status, 'played');
  assert.equal(f.voices[0]!.loop, true);
  f.fail(true);
  const failed = await f.audio.playMusic(Group, 'music');
  assert.equal(failed.status, 'failed');
  if (failed.status === 'failed') {
    assert.equal(failed.error.group, 'audio-game');
    assert.equal(failed.error.key, 'music');
    assert.equal(failed.error.operation, 'start');
  }
  assert.equal(f.voices[0]!.stops, 0);
  f.fail(false);
  const next = await f.audio.playMusic(Group, 'music');
  assert.equal(next.status, 'played');
  assert.equal(f.voices[0]!.stops, 1);
  assert.equal(f.stats().decodes, 1);
  f.audio.mixer.setMuted(true);
  f.audio.pauseMusic();
  f.audio.resumeMusic();
  assert.equal(f.voices[1]!.pauses, 1);
  assert.equal(f.voices[1]!.resumes, 1);
  assert.equal(f.audio.mixer.preferences().muted, true);
  f.scope.dispose();
  f.owner.dispose();
  assert.equal(f.voices[1]!.stops, 1);
  assert.equal(f.stats().released, 1);
  assert.equal(f.errors.length, 0);
});

test('effect drop-oldest retires the previous request and pending starts count against the concurrency bound', async () => {
  const f = fixture('drop-oldest');
  await f.audio.mixer.unlock();
  const first = await f.audio.playEffect(Group, 'effect');
  const second = await f.audio.playEffect(Group, 'effect');
  assert.equal(first.status, 'played');
  assert.equal(second.status, 'played');
  assert.equal(f.voices[0]!.stops, 1);
  if (first.status === 'played') assert.equal(first.playback.state, 'stopped');
  f.scope.dispose();
  f.owner.dispose();
  const pending = fixture();
  await pending.audio.mixer.unlock();
  pending.delay();
  const request = pending.audio.playEffect(Group, 'effect');
  await settle();
  assert.deepEqual(await pending.audio.playEffect(Group, 'effect'), {
    status: 'blocked',
    reason: 'limit',
  });
  pending.scope.dispose();
  assert.deepEqual(await request, { status: 'cancelled' });
  pending.finish();
  await settle();
  assert.equal(pending.voices[0]!.stops, 1);
  assert.equal(pending.errors.length, 0);
  pending.owner.dispose();
});

test('disposing while decoding settles playback cancellation without leaving an unhandled abort or starting audio', async () => {
  const scope = new Scope(),
    owner = new ComponentOwner();
  let finish!: (value: object) => void,
    starts = 0,
    released = 0;
  const assets = new AssetService(
    {
      transport: () => ({
        async load() {
          return new ArrayBuffer(2);
        },
      }),
    },
    (error) => {
      throw error;
    },
  );
  const driver: AudioDriver = {
    unlock: async () => 'ready',
    decode: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    start() {
      starts++;
      throw new Error('late start');
    },
    release() {
      released++;
    },
    close() {},
  };
  const audio = new AudioService({ scope, driver, assets: assets.forOwner(owner) });
  await audio.mixer.unlock();
  const request = audio.playMusic(Group, 'music');
  await settle();
  scope.dispose();
  assert.deepEqual(await request, { status: 'cancelled' });
  finish({});
  await settle();
  assert.equal(starts, 0);
  assert.equal(released, 1);
  assets.dispose();
  owner.dispose();
});

test('a newer music request cancels an older pending start and reclaims its late voice', async () => {
  const f = fixture();
  await f.audio.mixer.unlock();
  f.delay();
  const first = f.audio.playMusic(Group, 'music');
  await settle();
  const second = f.audio.playMusic(Group, 'music');
  await settle();
  assert.deepEqual(await first, { status: 'cancelled' });
  f.finish(0);
  await settle();
  assert.equal(f.voices[0]!.stops, 1);
  f.finish(1);
  assert.equal((await second).status, 'played');
  assert.equal(f.voices[1]!.stops, 0);
  f.scope.dispose();
  f.owner.dispose();
  assert.equal(f.voices[1]!.stops, 1);
  assert.equal(f.errors.length, 0);
});
