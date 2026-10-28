import { Cancellation, type Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { signal, SIGNAL, type ReadSignal } from './reactivity.js';
import { reportApplicationError } from './errors.js';
import {
  AudioError,
  type AudioState,
  type AudioDriver,
  type AudioPreferences,
  type AudioGroup,
  type AudioChannel,
  type AudioVoice,
  type AudioUnlockResult,
} from './audio-driver.js';
function readonly<T>(value: ReadSignal<T>): ReadSignal<T> {
  return Object.freeze(
    Object.defineProperty(() => value(), SIGNAL, { value: true }),
  ) as ReadSignal<T>;
}

/** Internal application mixer. Typed resource loading/playback and per-owner ownership follow in audio.ts. */
export function createAudioMixer(options: {
  scope: Scope;
  driver: AudioDriver;
  ownsDriver?: boolean;
  onError?: (error: AudioError) => void;
}) {
  const state = signal<AudioState>('locked'),
    preferences = signal<AudioPreferences>({
      volumes: { master: 1, music: 1, effects: 1 },
      muted: false,
    });
  const cancellation = new Cancellation(),
    voices = new Map<AudioVoice, { channel: AudioChannel; group: string; key: string }>();
  let closed = false,
    adopted = false,
    pending: Promise<AudioUnlockResult> | undefined;
  const assertOpen = (operation: string): void => {
    if (closed)
      throw new AudioError('<driver>', '<mixer>', operation, new Error('Mixer is disposed'));
  };
  const gain = (channel: AudioChannel): number => {
    const current = preferences();
    return current.muted ? 0 : current.volumes.master * current.volumes[channel];
  };
  const apply = (): void => {
    const errors: unknown[] = [];
    for (const [voice, source] of [...voices]) {
      if (closed) break;
      try {
        voice.setGain(gain(source.channel));
      } catch (error) {
        errors.push(new AudioError(source.group, source.key, 'gain', error));
      }
    }
    if (errors.length)
      throw new AudioError('<settings>', '<volume>', 'apply', new AggregateError(errors));
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    state.set('disposed');
    cancellation.cancel();
    if (!adopted) return;
    const errors: unknown[] = [];
    for (const [voice, source] of [...voices]) {
      try {
        voice.stop();
      } catch (error) {
        errors.push(new AudioError(source.group, source.key, 'stop', error));
      }
    }
    voices.clear();
    if (options.ownsDriver !== false)
      try {
        const result = options.driver.close();
        if (result && typeof result.then === 'function')
          void Promise.resolve(result).catch((cause): void => {
            const error = new AudioError('<driver>', '<context>', 'close', cause);
            reportApplicationError(
              error,
              options.onError ? () => options.onError!(error) : undefined,
            );
          });
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AudioError('<driver>', '<context>', 'dispose', new AggregateError(errors));
  };
  options.scope.own(dispose);
  assertOpen('create');
  adopted = true;
  return Object.freeze({
    state: readonly(state),
    preferences: readonly(preferences),
    gain,
    unlock(): Promise<AudioUnlockResult> {
      if (closed) return Promise.resolve({ status: 'cancelled' });
      if (pending) return pending;
      // A native context can suspend after an earlier successful unlock.
      // Recheck it during each explicit interaction; only pending attempts are shared.
      // Invoke before creating a Promise chain: resume() may require the active user gesture.
      let unlocking: ReturnType<AudioDriver['unlock']>;
      try {
        unlocking = options.driver.unlock();
      } catch (cause) {
        unlocking = Promise.reject(cause);
      }
      let off: Cleanup = () => {};
      const interrupted = new Promise<'cancelled'>((resolve) => {
        off = cancellation.subscribe(() => resolve('cancelled'));
      });
      const attempt: Promise<AudioUnlockResult> = Promise.race([
        Promise.resolve(unlocking),
        interrupted,
      ])
        .then((result): AudioUnlockResult => {
          if (closed || result === 'cancelled') return { status: 'cancelled' };
          if (!['locked', 'ready', 'suspended'].includes(result))
            throw new Error('Driver returned invalid unlock state');
          state.set(result);
          return result === 'ready' ? { status: 'ready' } : { status: 'blocked', reason: result };
        })
        .catch((cause): AudioUnlockResult => {
          if (closed) return { status: 'cancelled' };
          state.set('failed');
          return {
            status: 'failed',
            error: new AudioError('<driver>', '<unlock>', 'unlock', cause),
          } as AudioUnlockResult;
        })
        .finally(() => {
          off();
          if (pending === attempt) pending = undefined;
        });
      pending = attempt;
      return attempt;
    },
    setVolume(group: AudioGroup, value: number): void {
      assertOpen('volume');
      if (
        !Object.hasOwn(preferences().volumes, group) ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      )
        throw new AudioError(
          '<settings>',
          String(group),
          'volume',
          new Error('Volume must be within [0,1]'),
        );
      preferences.update((current) => ({
        ...current,
        volumes: { ...current.volumes, [group]: value },
      }));
      apply();
    },
    setMuted(muted: boolean): void {
      assertOpen('mute');
      if (typeof muted !== 'boolean')
        throw new AudioError('<settings>', 'muted', 'mute', new Error('Muted must be boolean'));
      preferences.update((current) => ({ ...current, muted }));
      apply();
    },
    restorePreferences(value: AudioPreferences): void {
      assertOpen('restore');
      if (
        !value ||
        typeof value.muted !== 'boolean' ||
        !value.volumes ||
        !['master', 'music', 'effects'].every((key) => {
          const volume = value.volumes[key as AudioGroup];
          return (
            typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1
          );
        })
      )
        throw new AudioError(
          '<settings>',
          '<preferences>',
          'restore',
          new Error('Complete finite [0,1] volumes and boolean muted are required'),
        );
      preferences.set({
        muted: value.muted,
        volumes: {
          master: value.volumes.master,
          music: value.volumes.music,
          effects: value.volumes.effects,
        },
      });
      apply();
    },
    attach(
      voice: AudioVoice,
      channel: AudioChannel,
      source: { group: string; key: string },
    ): Cleanup {
      assertOpen('attach');
      if (channel !== 'music' && channel !== 'effects')
        throw new AudioError(
          source.group,
          source.key,
          'attach',
          new Error('Unknown audio channel'),
        );
      if (voices.has(voice))
        throw new AudioError(
          source.group,
          source.key,
          'attach',
          new Error('Voice already attached'),
        );
      try {
        voice.setGain(gain(channel));
      } catch (error) {
        throw new AudioError(source.group, source.key, 'gain', error);
      }
      assertOpen('attach');
      const record = { ...source, channel };
      voices.set(voice, record);
      return () => {
        if (voices.get(voice) === record) voices.delete(voice);
      };
    },
    dispose,
  });
}
