import type { AtlasFrame, AssetImage } from './asset-types.js';
import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
export const THEME = Symbol('application theme');
export type ThemeTokens = Readonly<Record<string, string | number>>;
export interface ThemeImage {
  readonly kind: 'image';
  readonly src: string;
}
export interface ThemeAtlasRegion {
  readonly kind: 'atlas-region';
  readonly src: string;
  readonly frame: AtlasFrame;
}
export type ThemeAsset = ThemeImage | ThemeAtlasRegion;
export type ThemeAssets = Readonly<Record<string, ThemeAsset>>;
type TokenValue<V> = V extends number ? number : V extends string ? string : never;
export type ThemeTokenValues<T extends ThemeTokens> = { readonly [K in keyof T]: TokenValue<T[K]> };
export type ThemeAssetValues<A extends ThemeAssets> = { readonly [K in keyof A]: ThemeAsset };
export interface ThemeDefinition<T extends ThemeTokens, A extends ThemeAssets> {
  readonly [THEME]: true;
  readonly name: string;
  readonly tokens: Readonly<T>;
  readonly assets: Readonly<A>;
  readonly defaultAssets: Readonly<A>;
}
export interface ThemeOverrides<T extends ThemeTokens, A extends ThemeAssets> {
  readonly name: string;
  readonly tokens?: Partial<ThemeTokenValues<T>>;
  readonly assets?: Partial<ThemeAssetValues<A>>;
}
export interface ThemeContext<T extends ThemeTokens, A extends ThemeAssets> {
  readonly name: string;
  readonly tokens: Readonly<T>;
  resolve<K extends keyof A & string>(key: K): ThemeAsset;
  load<K extends keyof A & string>(key: K, options?: ThemeLoadOptions): Promise<ThemeImageLease>;
}
export interface ThemeLoadOptions {
  readonly signal?: CancellationSignal;
}
interface ThemeImageLeaseBase {
  readonly image: AssetImage;
  readonly fallback: boolean;
  readonly diagnostic?: ThemeError;
  release(): void;
}
export type ThemeImageLease = ThemeImageLeaseBase &
  (
    | { readonly kind: 'image'; readonly asset: ThemeImage; readonly frame?: never }
    | {
        readonly kind: 'atlas-region';
        readonly asset: ThemeAtlasRegion;
        readonly frame: AtlasFrame;
      }
  );
export class ThemeError extends Error {
  readonly module = 'theme-assets';
  readonly source: string;
  constructor(
    readonly theme: string,
    readonly key: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Theme ${theme}.${key}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'ThemeError';
    this.source = `${theme}.${key}`;
  }
}
