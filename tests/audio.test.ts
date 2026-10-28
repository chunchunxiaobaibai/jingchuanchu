import assert from 'node:assert/strict';
import test from 'node:test';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  AudioError,
  type AudioDriver,
  type AudioVoice,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createAudioMixer } from '../packages/app/runtime/audio-mixer.js';
function driver(unlock: AudioDriver['unlock']): AudioDriver {
  return {
    unlock,
    async decode() {
      throw new Error('Not used in mixer checks');
    },
    start() {
      throw new Error('Not used in mixer checks');
    },
    release() {},
    close() {},
  };
}
function voice() {
  const gains: number[] = [];
  let stopped = 0;
  const value: AudioVoice = {
    setGain: (gain) => {
      gains.push(gain);
    },
    pause() {},
    resume() {},
    stop() {
      stopped++;
    },
  };
  return { value, gains, stopped: () => stopped };
}

test('unlock calls driver within the initiating stack, coalesces pending attempts and distinguishes blocked/failure/ready', async () => {
  const scope = new Scope();
  let calls = 0,
    finish!: (value: 'ready' | 'locked' | 'suspended') => void;
  const mixer = createAudioMixer({
    scope,
    driver: driver(() => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  });
  assert.equal(mixer.state(), 'locked');
  const first = mixer.unlock();
  assert.equal(calls, 1);
  assert.equal(mixer.unlock(), first);
  finish('suspended');
  assert.deepEqual(await first, { status: 'blocked', reason: 'suspended' });
  assert.equal(mixer.state(), 'suspended');
  const next = mixer.unlock();
  finish('locked');
  assert.deepEqual(await next, { status: 'blocked', reason: 'locked' });
  const ready = mixer.unlock();
  finish('ready');
  assert.deepEqual(await ready, { status: 'ready' });
  assert.equal(mixer.state(), 'ready');
  const suspendedAgain = mixer.unlock();
  assert.equal(calls, 4);
  finish('suspended');
  assert.deepEqual(await suspendedAgain, { status: 'blocked', reason: 'suspended' });
  const resumedAgain = mixer.unlock();
  assert.equal(calls, 5);
  finish('ready');
  assert.deepEqual(await resumedAgain, { status: 'ready' });
  scope.dispose();
  let fail = true;
  const cause = new Error('unlock denied');
  const retryScope = new Scope(),
    retry = createAudioMixer({
      scope: retryScope,
      driver: driver(async () => {
        if (fail) throw cause;
        return 'ready';
      }),
    });
  const result = await retry.unlock();
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.error.operation, 'unlock');
    assert.equal(result.error.cause, cause);
  }
  assert.equal(retry.state(), 'failed');
  fail = false;
  assert.deepEqual(await retry.unlock(), { status: 'ready' });
  retryScope.dispose();
});

test('master/group gains and mute update attached voices while preserving independent volume preferences', () => {
  const scope = new Scope(),
    mixer = createAudioMixer({ scope, driver: driver(async () => 'ready') });
  const music = voice(),
    effect = voice();
  mixer.attach(music.value, 'music', { group: 'game', key: 'theme' });
  const off = mixer.attach(effect.value, 'effects', { group: 'game', key: 'click' });
  mixer.setVolume('master', 0.5);
  mixer.setVolume('music', 0.4);
  mixer.setVolume('effects', 0.8);
  assert.equal(music.gains.at(-1), 0.2);
  assert.equal(effect.gains.at(-1), 0.4);
  mixer.setMuted(true);
  assert.equal(music.gains.at(-1), 0);
  assert.equal(effect.gains.at(-1), 0);
  mixer.setVolume('music', 0.2);
  mixer.setMuted(false);
  assert.equal(music.gains.at(-1), 0.1);
  assert.equal(mixer.preferences().volumes.effects, 0.8);
  assert.equal(mixer.preferences().muted, false);
  assert.equal(Reflect.set(mixer.preferences().volumes, 'master', 1), false);
  for (const invalid of [-1, 2, NaN, Infinity])
    assert.throws(() => mixer.setVolume('master', invalid), AudioError);
  off();
  const count = effect.gains.length;
  mixer.setVolume('master', 1);
  assert.equal(effect.gains.length, count);
  scope.dispose();
  assert.equal(music.stopped(), 1);
  assert.equal(effect.stopped(), 0);
});

test('scope exit settles ignored pending unlock, stops attached voices and closes only an owned driver once', async () => {
  const scope = new Scope();
  let finish!: (value: 'ready') => void,
    closed = 0;
  const owned = driver(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  owned.close = () => {
    closed++;
  };
  const mixer = createAudioMixer({ scope, driver: owned }),
    music = voice();
  mixer.attach(music.value, 'music', { group: 'game', key: 'theme' });
  const pending = mixer.unlock();
  scope.dispose();
  mixer.dispose();
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(mixer.state(), 'disposed');
  assert.equal(closed, 1);
  assert.equal(music.stopped(), 1);
  finish('ready');
  await Promise.resolve();
  assert.equal(mixer.state(), 'disposed');
  assert.deepEqual(await mixer.unlock(), { status: 'cancelled' });
  assert.throws(() => mixer.setMuted(false), AudioError);
  const sharedScope = new Scope();
  createAudioMixer({ scope: sharedScope, driver: owned, ownsDriver: false });
  sharedScope.dispose();
  assert.equal(closed, 1);
});

test('external preference restore validates the complete record before committing and applies an owned snapshot', () => {
  const scope = new Scope(),
    mixer = createAudioMixer({ scope, driver: driver(async () => 'ready') }),
    music = voice();
  mixer.attach(music.value, 'music', { group: 'game', key: 'theme' });
  const previous = mixer.preferences();
  assert.throws(
    () =>
      mixer.restorePreferences({
        muted: false,
        volumes: { master: 0.2, music: NaN, effects: 0.8 },
      }),
    AudioError,
  );
  assert.equal(mixer.preferences(), previous);
  const incoming = { muted: false, volumes: { master: 0.5, music: 0.4, effects: 0.8 } };
  mixer.restorePreferences(incoming);
  incoming.volumes.music = 1;
  assert.equal(mixer.preferences().volumes.music, 0.4);
  assert.equal(music.gains.at(-1), 0.2);
  scope.dispose();
});
