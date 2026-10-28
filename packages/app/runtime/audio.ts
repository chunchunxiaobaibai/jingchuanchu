import {
  Cancellation,
  Scope,
  type CancellationSignal,
  type Cleanup,
} from '@xiaobaibaifqy/jingchuanchu-core';
import type { AssetContext, AssetEntries, AssetGroup } from './asset-types.js';
import { AudioClipCache, type AudioClipLease, type AudioKey } from './audio-clips.js';
import { createAudioMixer } from './audio-mixer.js';
import {
  AudioError,
  type AudioDriver,
  type AudioVoice,
  type AudioChannel,
} from './audio-driver.js';
import { reportApplicationError } from './errors.js';
export type AudioPlaybackState = 'playing' | 'paused' | 'stopped' | 'ended';
export interface AudioPlayback {
  readonly state: AudioPlaybackState;
  stop(): void;
}
export type AudioPlayResult =
  | { readonly status: 'played'; readonly playback: AudioPlayback }
  | { readonly status: 'blocked'; readonly reason: 'locked' | 'suspended' | 'failed' | 'limit' }
  | { readonly status: 'failed'; readonly error: AudioError }
  | { readonly status: 'cancelled' };
export interface AudioPlaybackOptions {
  readonly loop?: boolean;
}
export interface AudioOwner {
  readonly key: object;
  readonly signal: CancellationSignal;
  readonly assets: AssetContext;
}
interface Request {
  readonly owner: object | undefined;
  offOwner: Cleanup | undefined;
  readonly group: string;
  readonly key: string;
  readonly channel: AudioChannel;
  readonly cancellation: Cancellation;
  readonly playback: AudioPlayback;
  closed: boolean;
  started: boolean;
  manualPaused: boolean;
  autoPaused: boolean;
  ended: boolean;
  state: AudioPlaybackState;
  clip: AudioClipLease | undefined;
  voice: AudioVoice | undefined;
  detach: Cleanup | undefined;
}

/** Internal app playback service; owner-bound app/component/scene facades follow in T26. */
export class AudioService {
  readonly mixer: ReturnType<typeof createAudioMixer>;
  private readonly clips: AudioClipCache;
  private readonly life = new Scope();
  private readonly requests = new Set<Request>();
  private readonly effects = new Set<Request>();
  private readonly inactiveOwners = new Set<object>();
  private music: Request | undefined;
  private pendingMusic: Request | undefined;
  private closed = false;
  private readonly maxEffects: number;
  private readonly policy: 'drop-new' | 'drop-oldest';
  constructor(
    private readonly options: {
      scope: Scope;
      driver: AudioDriver;
      assets: AssetContext;
      ownsDriver?: boolean;
      maxEffects?: number;
      effectPolicy?: 'drop-new' | 'drop-oldest';
      onError?: (error: AudioError) => void;
    },
  ) {
    this.maxEffects = options.maxEffects ?? 16;
    this.policy = options.effectPolicy ?? 'drop-new';
    if (
      !Number.isSafeInteger(this.maxEffects) ||
      this.maxEffects < 1 ||
      !['drop-new', 'drop-oldest'].includes(this.policy)
    )
      throw new AudioError(
        '<settings>',
        'effects',
        'create',
        new Error('A positive effect limit and drop-new/drop-oldest policy are required'),
      );
    this.mixer = createAudioMixer({
      scope: this.life,
      driver: options.driver,
      ...(options.ownsDriver !== undefined ? { ownsDriver: options.ownsDriver } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    this.clips = new AudioClipCache(options.driver, this.life, options.onError);
    options.scope.own(() => this.dispose());
    if (this.closed)
      throw new AudioError('<driver>', '<service>', 'create', new Error('Scope is disposed'));
  }
  private report(error: AudioError): void {
    reportApplicationError(
      error,
      this.options.onError ? () => this.options.onError!(error) : undefined,
    );
  }
  private finish(request: Request, ended = false): void {
    if (request.closed) return;
    request.closed = true;
    request.state = ended ? 'ended' : 'stopped';
    this.requests.delete(request);
    this.effects.delete(request);
    if (this.music === request) this.music = undefined;
    if (this.pendingMusic === request) this.pendingMusic = undefined;
    const errors: unknown[] = [];
    const voice = request.voice,
      clip = request.clip,
      detach = request.detach,
      offOwner = request.offOwner;
    request.voice = undefined;
    request.clip = undefined;
    request.detach = undefined;
    request.offOwner = undefined;
    for (const cleanup of [
      () => offOwner?.(),
      () => detach?.(),
      () => {
        if (!ended) voice?.stop();
      },
      () => request.cancellation.cancel(),
      () => clip?.release(),
    ])
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AudioError(request.group, request.key, 'stop', new AggregateError(errors));
  }
  private quiet(request: Request, ended = false): void {
    try {
      this.finish(request, ended);
    } catch (error) {
      this.report(error as AudioError);
    }
  }
  private async play<E extends AssetEntries>(
    channel: AudioChannel,
    group: AssetGroup<E>,
    key: AudioKey<E>,
    options: AudioPlaybackOptions = {},
    owner?: AudioOwner,
  ): Promise<AudioPlayResult> {
    if (this.closed || owner?.signal.aborted) return { status: 'cancelled' };
    if (owner && this.inactiveOwners.has(owner.key))
      return { status: 'blocked', reason: 'suspended' };
    const state = this.mixer.state();
    if (state !== 'ready')
      return state === 'disposed' ? { status: 'cancelled' } : { status: 'blocked', reason: state };
    if (options.loop !== undefined && typeof options.loop !== 'boolean')
      return {
        status: 'failed',
        error: new AudioError(group.name, String(key), 'play', new Error('Loop must be boolean')),
      };
    if (channel === 'effects' && this.effects.size >= this.maxEffects) {
      if (this.policy === 'drop-new') return { status: 'blocked', reason: 'limit' };
      const oldest = this.effects.values().next().value!;
      this.quiet(oldest);
    }
    if (channel === 'music' && this.pendingMusic) this.quiet(this.pendingMusic);
    let request: Request;
    const playback: AudioPlayback = Object.freeze({
      get state() {
        return request.state;
      },
      stop: () => this.finish(request),
    });
    request = {
      owner: owner?.key,
      offOwner: undefined,
      group: group.name,
      key: String(key),
      channel,
      cancellation: new Cancellation(),
      playback,
      closed: false,
      started: false,
      manualPaused: false,
      autoPaused: false,
      ended: false,
      state: 'playing',
      clip: undefined,
      voice: undefined,
      detach: undefined,
    };
    this.requests.add(request);
    if (channel === 'music') this.pendingMusic = request;
    else this.effects.add(request);
    if (owner) request.offOwner = owner.signal.subscribe(() => this.quiet(request));
    let offAbort: Cleanup = () => {};
    const abort = new Promise<never>((_, reject) => {
      offAbort = request.cancellation.subscribe(() => reject(new Error('Playback cancelled')));
    });
    // Decode can settle on cancellation before start() has installed its race.
    void abort.catch(() => {});
    let operation = 'load';
    try {
      const acquired = await this.clips.load(
        owner?.assets ?? this.options.assets,
        group,
        key,
        request.cancellation,
      );
      if (request.closed) {
        acquired.release();
        return { status: 'cancelled' };
      }
      request.clip = acquired;
      operation = 'start';
      const starting = Promise.resolve(
        this.options.driver.start(acquired.decoded, {
          loop: options.loop ?? channel === 'music',
          gain: this.mixer.gain(channel),
          onEnded: () => {
            request.ended = true;
            if (request.started) this.quiet(request, true);
          },
        }),
      ).then((voice) => {
        if (
          !voice ||
          ['stop', 'pause', 'resume', 'setGain'].some(
            (method) => typeof voice[method as keyof AudioVoice] !== 'function',
          )
        )
          throw new Error('Driver returned an invalid voice');
        if (request.closed) {
          try {
            voice.stop();
          } catch (error) {
            this.report(new AudioError(group.name, String(key), 'stop-late', error));
          }
        } else request.voice = voice;
        return voice;
      });
      const voice = await Promise.race([starting, abort]);
      if (request.closed) return { status: 'cancelled' };
      request.detach = this.mixer.attach(voice, channel, { group: group.name, key: String(key) });
      if (request.closed) {
        request.detach();
        request.detach = undefined;
        return { status: 'cancelled' };
      }
      request.started = true;
      if (channel === 'music') {
        if (this.music) this.quiet(this.music);
        if (request.closed) return { status: 'cancelled' };
        this.music = request;
        this.pendingMusic = undefined;
      }
      if (request.ended) this.quiet(request, true);
      return { status: 'played', playback };
    } catch (error) {
      if (request.closed) return { status: 'cancelled' };
      this.quiet(request);
      return {
        status: 'failed',
        error:
          error instanceof AudioError
            ? error
            : new AudioError(group.name, String(key), operation, error),
      };
    } finally {
      offAbort();
    }
  }
  playMusic<E extends AssetEntries>(
    group: AssetGroup<E>,
    key: AudioKey<E>,
    options?: AudioPlaybackOptions,
    owner?: AudioOwner,
  ): Promise<AudioPlayResult> {
    return this.play('music', group, key, options, owner);
  }
  playEffect<E extends AssetEntries>(
    group: AssetGroup<E>,
    key: AudioKey<E>,
    options?: AudioPlaybackOptions,
    owner?: AudioOwner,
  ): Promise<AudioPlayResult> {
    return this.play('effects', group, key, options, owner);
  }
  private syncMusic(request: Request): void {
    if (request.closed || !request.started) return;
    const paused = request.manualPaused || request.autoPaused;
    if (paused && request.state === 'playing') {
      try {
        request.voice!.pause();
        request.state = 'paused';
      } catch (error) {
        throw new AudioError(request.group, request.key, 'pause', error);
      }
    } else if (!paused && request.state === 'paused') {
      try {
        request.voice!.resume();
        request.state = 'playing';
      } catch (error) {
        throw new AudioError(request.group, request.key, 'resume', error);
      }
    }
  }
  pauseMusic(owner?: object): void {
    const request = this.music;
    if (!request || request.owner !== owner || request.closed) return;
    request.manualPaused = true;
    this.syncMusic(request);
  }
  resumeMusic(owner?: object): void {
    const request = this.music;
    if (!request || request.owner !== owner || request.closed) return;
    request.manualPaused = false;
    this.syncMusic(request);
  }
  setOwnerActive(owner: object, active: boolean): void {
    if (this.closed) return;
    if (active) this.inactiveOwners.delete(owner);
    else this.inactiveOwners.add(owner);
    const errors: unknown[] = [];
    for (const request of [...this.requests]) {
      if (request.owner !== owner || request.closed) continue;
      if (!active && (!request.started || request.channel === 'effects')) {
        this.quiet(request);
        continue;
      }
      request.autoPaused = !active;
      try {
        this.syncMusic(request);
      } catch (error) {
        errors.push(error);
        this.quiet(request);
      }
    }
    if (errors.length)
      this.report(new AudioError('<owner>', '<music>', 'activity', new AggregateError(errors)));
  }
  forgetOwner(owner: object): void {
    this.inactiveOwners.delete(owner);
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.inactiveOwners.clear();
    const errors: unknown[] = [];
    for (const request of [...this.requests])
      try {
        this.finish(request);
      } catch (error) {
        errors.push(error);
      }
    try {
      this.life.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AudioError('<driver>', '<service>', 'dispose', new AggregateError(errors));
  }
}
