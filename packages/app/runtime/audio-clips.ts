import {
  Cancellation,
  type CancellationSignal,
  type Cleanup,
  type Scope,
} from '@xiaobaibaifqy/jingchuanchu-core';
import type {
  AssetContext,
  AssetGroup,
  AssetEntries,
  AudioAssetEntry,
  AssetGroupLease,
} from './asset-types.js';
import { AudioError, type AudioDriver, type DecodedAudio } from './audio-driver.js';
import { reportApplicationError } from './errors.js';
export type AudioKey<E extends AssetEntries> = {
  [K in keyof E & string]: E[K] extends AudioAssetEntry ? K : never;
}[keyof E & string];
export interface AudioClipLease {
  readonly decoded: DecodedAudio;
  release(): void;
}
interface Decode {
  refs: number;
  readonly cancellation: Cancellation;
  promise: Promise<DecodedAudio>;
  decoded: DecodedAudio | undefined;
  readonly source: { group: string; key: string };
}

/** Internal decoder cache; raw AssetGroup and decoded references retire together. No playback queue. */
export class AudioClipCache {
  private readonly records = new Map<ArrayBuffer, Decode>();
  private readonly requests = new Set<() => void>();
  private closed = false;
  constructor(
    private readonly driver: AudioDriver,
    scope: Scope,
    private readonly onError?: (error: AudioError) => void,
  ) {
    scope.own(() => this.dispose());
    if (this.closed)
      throw new AudioError('<driver>', '<clips>', 'create', new Error('Scope is disposed'));
  }
  private report(error: AudioError): void {
    reportApplicationError(error, this.onError ? () => this.onError!(error) : undefined);
  }
  private releaseDecoded(record: Decode): void {
    const decoded = record.decoded;
    record.decoded = undefined;
    if (decoded)
      try {
        this.driver.release(decoded);
      } catch (error) {
        throw new AudioError(record.source.group, record.source.key, 'release', error);
      }
  }
  private retain(data: ArrayBuffer, source: { group: string; key: string }): Decode {
    const existing = this.records.get(data);
    if (existing) {
      existing.refs++;
      return existing;
    }
    const record: Decode = {
      refs: 1,
      cancellation: new Cancellation(),
      decoded: undefined,
      source,
      promise: undefined!,
    };
    this.records.set(data, record);
    record.promise = Promise.resolve()
      .then(() => {
        record.cancellation.throwIfAborted();
        // A host decoder may consume/detach its input; the asset cache keeps the original bytes.
        return this.driver.decode(data.slice(0), record.cancellation);
      })
      .then((decoded) => {
        if (!decoded || typeof decoded !== 'object')
          throw new Error('Driver decode must return an object');
        record.decoded = decoded;
        if (!record.refs)
          try {
            this.releaseDecoded(record);
          } catch (error) {
            this.report(error as AudioError);
          }
        return decoded;
      });
    return record;
  }
  private drop(data: ArrayBuffer, record: Decode): void {
    if (--record.refs !== 0) return;
    if (this.records.get(data) === record) this.records.delete(data);
    const errors: unknown[] = [];
    try {
      record.cancellation.cancel();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.releaseDecoded(record);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AudioError(
        record.source.group,
        record.source.key,
        'release',
        new AggregateError(errors),
      );
  }
  async load<E extends AssetEntries>(
    assets: AssetContext,
    group: AssetGroup<E>,
    key: AudioKey<E>,
    signal: CancellationSignal,
  ): Promise<AudioClipLease> {
    const failure = (operation: string, error: unknown) =>
      new AudioError(group.name, String(key), operation, error);
    if (this.closed) throw failure('load', new Error('Decoder cache is disposed'));
    if (!Object.hasOwn(group.entries, key) || group.entries[key]?.kind !== 'audio')
      throw failure('load', new Error('Expected an audio resource key'));
    let closed = false,
      lease: AssetGroupLease<E> | undefined,
      record: Decode | undefined,
      data: ArrayBuffer | undefined,
      off: Cleanup | undefined;
    let operation = 'load';
    const cancellation = new Cancellation();
    const close = (): void => {
      if (closed) return;
      closed = true;
      off?.();
      off = undefined;
      this.requests.delete(close);
      const errors: unknown[] = [];
      for (const cleanup of [
        () => cancellation.cancel(),
        () => {
          if (record && data) this.drop(data, record);
        },
        () => lease?.release(),
      ])
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      record = undefined;
      lease = undefined;
      data = undefined;
      if (errors.length) throw failure('release', new AggregateError(errors));
    };
    const quiet = (): void => {
      try {
        close();
      } catch (error) {
        this.report(error as AudioError);
      }
    };
    this.requests.add(close);
    off = signal.subscribe(quiet);
    let offAbort: Cleanup = () => {};
    const abort = new Promise<never>((_, reject) => {
      offAbort = cancellation.subscribe(() =>
        reject(failure('cancel', signal.reason ?? new Error('Audio reference released'))),
      );
    });
    const work = async (): Promise<AudioClipLease> => {
      cancellation.throwIfAborted();
      const acquired = await assets.load(group, { signal: cancellation });
      if (closed) {
        acquired.release();
        throw failure('cancel', new Error('Audio reference released'));
      }
      lease = acquired;
      const value = lease.get(key);
      if (Object.prototype.toString.call(value) !== '[object ArrayBuffer]')
        throw new Error('Audio bytes are missing or invalid');
      data = value as ArrayBuffer;
      operation = 'decode';
      record = this.retain(data, { group: group.name, key: String(key) });
      await record.promise;
      if (closed) throw failure('cancel', new Error('Audio reference released'));
      return Object.freeze({
        get decoded() {
          if (closed) throw failure('read', new Error('Audio clip released'));
          return record!.decoded!;
        },
        release: close,
      });
    };
    try {
      const result = await Promise.race([work(), abort]);
      if (closed) throw failure('cancel', new Error('Audio reference released'));
      return result;
    } catch (error) {
      quiet();
      throw error instanceof AudioError ? error : failure(operation, error);
    } finally {
      offAbort();
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const close of [...this.requests])
      try {
        close();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AudioError('<driver>', '<clips>', 'dispose', new AggregateError(errors));
  }
}
