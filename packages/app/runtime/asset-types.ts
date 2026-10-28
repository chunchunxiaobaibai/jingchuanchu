import type { ReadonlyData } from '../state.js';
import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
export const ASSET_GROUP = Symbol('asset group');
interface AssetBase {
  readonly url: string;
  readonly optional?: boolean;
}
export interface ImageAssetEntry extends AssetBase {
  readonly kind: 'image';
}
export interface AudioAssetEntry extends AssetBase {
  readonly kind: 'audio';
}
export interface JsonAssetEntry<T = unknown> extends AssetBase {
  readonly kind: 'json';
  readonly parse: (value: unknown) => T;
}
export interface AtlasFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type AtlasFrames = Readonly<Record<string, AtlasFrame>>;
export interface AtlasAssetEntry<F extends AtlasFrames = AtlasFrames> extends AssetBase {
  readonly kind: 'atlas';
  readonly frames: F;
}
export type AssetEntry = ImageAssetEntry | AudioAssetEntry | JsonAssetEntry | AtlasAssetEntry;
export type AssetEntries = Readonly<Record<string, AssetEntry>>;
export interface AssetImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}
export interface AssetAtlas<F extends AtlasFrames = AtlasFrames> {
  readonly image: AssetImage;
  readonly frames: ReadonlyData<F>;
}
export type DecodedAsset<D> =
  D extends JsonAssetEntry<infer T>
    ? ReadonlyData<T>
    : D extends AtlasAssetEntry<infer F>
      ? AssetAtlas<F>
      : D extends ImageAssetEntry
        ? AssetImage
        : D extends AudioAssetEntry
          ? ArrayBuffer
          : never;
export type AssetValue<D> = D extends { readonly optional?: infer O }
  ? true extends O
    ? DecodedAsset<D> | undefined
    : DecodedAsset<D>
  : DecodedAsset<D>;
export type SyncAssetEntries<E extends AssetEntries> = {
  readonly [K in keyof E]: E[K] extends JsonAssetEntry<infer T>
    ? Extract<T, PromiseLike<unknown>> extends never
      ? E[K]
      : never
    : E[K];
};
export interface AssetGroup<E extends AssetEntries> {
  readonly [ASSET_GROUP]: true;
  readonly name: string;
  readonly entries: ReadonlyData<E>;
}
export interface AssetTransport {
  load(entry: AssetEntry, signal: CancellationSignal): PromiseLike<unknown>;
  release?(entry: AssetEntry, raw: unknown): void | PromiseLike<void>;
}
export interface AssetGroupProgress {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'cancelled';
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
}
export interface AssetGroupLease<E extends AssetEntries> {
  get<K extends keyof E & string>(key: K): AssetValue<E[K]>;
  release(): void;
}
export interface AssetLoadOptions {
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: AssetGroupProgress) => void;
}
export interface AssetContext {
  load<E extends AssetEntries>(
    group: AssetGroup<E>,
    options?: AssetLoadOptions,
  ): Promise<AssetGroupLease<E>>;
}
export interface ApplicationAssetOptions {
  readonly transport: () => AssetTransport;
  readonly concurrency?: number;
}
export class AssetError extends Error {
  readonly module = 'asset-loading';
  readonly source: string;
  constructor(
    readonly group: string,
    readonly key: string,
    readonly url: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Asset ${group}.${key}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'AssetError';
    this.source = `${group}.${key}`;
  }
}
