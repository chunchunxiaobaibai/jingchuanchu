import type { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ReadSignal } from './reactivity.js';
import type { AssetContext, AssetEntries, AssetGroup } from './asset-types.js';
import { AudioService, type AudioPlayResult, type AudioPlaybackOptions } from './audio.js';
import type { AudioKey } from './audio-clips.js';
import {
  AudioError,
  type AudioDriver,
  type AudioState,
  type AudioPreferences,
  type AudioGroup,
  type AudioUnlockResult,
} from './audio-driver.js';
import { reportApplicationError } from './errors.js';
export interface ApplicationAudioOptions {
  readonly driver: () => AudioDriver;
  readonly ownsDriver?: boolean;
  readonly maxEffects?: number;
  readonly effectPolicy?: 'drop-new' | 'drop-oldest';
}
export interface AudioControls {
  readonly state: ReadSignal<AudioState>;
  readonly preferences: ReadSignal<AudioPreferences>;
  unlock(): Promise<AudioUnlockResult>;
  playMusic<E extends AssetEntries>(
    group: AssetGroup<E>,
    key: AudioKey<E>,
    options?: AudioPlaybackOptions,
  ): Promise<AudioPlayResult>;
  playEffect<E extends AssetEntries>(
    group: AssetGroup<E>,
    key: AudioKey<E>,
    options?: AudioPlaybackOptions,
  ): Promise<AudioPlayResult>;
  pauseMusic(): void;
  resumeMusic(): void;
  setVolume(group: AudioGroup, value: number): void;
  setMuted(muted: boolean): void;
  restorePreferences(value: AudioPreferences): void;
}
export function validateAudioOptions(options: ApplicationAudioOptions): void {
  if (
    typeof options.driver !== 'function' ||
    (options.ownsDriver !== undefined && typeof options.ownsDriver !== 'boolean') ||
    (options.maxEffects !== undefined &&
      (!Number.isSafeInteger(options.maxEffects) || options.maxEffects < 1)) ||
    (options.effectPolicy !== undefined &&
      !['drop-new', 'drop-oldest'].includes(options.effectPolicy))
  )
    throw new AudioError(
      '<settings>',
      '<config>',
      'define',
      new Error(
        'A synchronous driver factory, positive effect limit and valid ownership/policy are required',
      ),
    );
}
export function createApplicationAudio(
  options: ApplicationAudioOptions,
  assets: AssetContext,
  scope: Scope,
  onError: (error: AudioError) => void,
): AudioService {
  validateAudioOptions(options);
  let candidate: unknown;
  try {
    candidate = options.driver();
  } catch (error) {
    throw new AudioError('<driver>', '<factory>', 'create', error);
  }
  const reportClose = (cause: unknown): void => {
    const error = new AudioError('<driver>', '<context>', 'close', cause);
    reportApplicationError(error, () => onError(error));
  };
  const close = (value: unknown): void => {
    if (
      options.ownsDriver === false ||
      !value ||
      typeof (value as AudioDriver).close !== 'function'
    )
      return;
    try {
      const result = (value as AudioDriver).close();
      if (result) void Promise.resolve(result).catch((cause) => reportClose(cause));
    } catch (cause) {
      reportClose(cause);
    }
  };
  if (candidate && typeof (candidate as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(candidate).then(close, () => {});
    throw new AudioError(
      '<driver>',
      '<factory>',
      'create',
      new Error('audio.driver must synchronously return an AudioDriver'),
    );
  }
  if (
    !candidate ||
    ['unlock', 'decode', 'start', 'release', 'close'].some(
      (key) => typeof (candidate as unknown as Record<string, unknown>)[key] !== 'function',
    )
  ) {
    close(candidate);
    throw new AudioError(
      '<driver>',
      '<factory>',
      'create',
      new Error('AudioDriver methods are missing'),
    );
  }
  return new AudioService({ ...options, driver: candidate as AudioDriver, assets, scope, onError });
}
