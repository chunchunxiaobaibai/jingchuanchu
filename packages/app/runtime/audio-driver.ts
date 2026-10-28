import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
export type AudioState = 'locked' | 'ready' | 'suspended' | 'failed' | 'disposed';
export type AudioGroup = 'master' | 'music' | 'effects';
export type AudioChannel = Exclude<AudioGroup, 'master'>;
export type DecodedAudio = object;
export interface AudioVoice {
  setGain(value: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}
export interface AudioDriver {
  /** Called synchronously by unlock(), so the host can preserve a real interaction gesture. */
  unlock(): PromiseLike<'locked' | 'ready' | 'suspended'>;
  decode(data: ArrayBuffer, signal: CancellationSignal): PromiseLike<DecodedAudio>;
  start(
    audio: DecodedAudio,
    options: { readonly loop: boolean; readonly gain: number; readonly onEnded: () => void },
  ): AudioVoice | PromiseLike<AudioVoice>;
  release(audio: DecodedAudio): void;
  close(): void | PromiseLike<void>;
}
export class AudioError extends Error {
  readonly module = 'audio';
  readonly source: string;
  constructor(
    readonly group: string,
    readonly key: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Audio ${group}.${key}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.source = `${group}.${key}`;
    this.name = 'AudioError';
  }
}
export interface AudioPreferences {
  readonly volumes: Readonly<Record<AudioGroup, number>>;
  readonly muted: boolean;
}
export type AudioUnlockResult =
  | { readonly status: 'ready' }
  | { readonly status: 'blocked'; readonly reason: 'locked' | 'suspended' }
  | { readonly status: 'failed'; readonly error: AudioError }
  | { readonly status: 'cancelled' };
