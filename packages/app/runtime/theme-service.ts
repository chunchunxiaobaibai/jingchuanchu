import { Cancellation, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ComponentOwner } from './component-owner.js';
import { ASSETS_CONTEXT } from './context-keys.js';
import type { AssetContextProvider } from './asset-service.js';
import { defineAssetGroup } from './assets.js';
import {
  AssetError,
  type AssetGroup,
  type ImageAssetEntry,
  type AtlasAssetEntry,
  type AssetContext,
} from './asset-types.js';
import { reportApplicationError } from './errors.js';
import {
  THEME,
  ThemeError,
  type ThemeDefinition,
  type ThemeTokens,
  type ThemeAssets,
  type ThemeContext,
  type ThemeAsset,
  type ThemeLoadOptions,
  type ThemeImageLease,
} from './theme-types.js';
type ImageGroup = AssetGroup<{
  readonly resource: (ImageAssetEntry | AtlasAssetEntry) & { readonly optional: false };
}>;

export interface ThemeContextProvider {
  forOwner<T extends ThemeTokens, A extends ThemeAssets>(
    owner: ComponentOwner,
    contract: ThemeDefinition<T, A>,
  ): ThemeContext<T, A>;
}

/** CSS changes are confined to the application host and restored individually. */
export function mountThemeTokens(
  host: Element,
  definition: ThemeDefinition<ThemeTokens, ThemeAssets>,
): Cleanup {
  const style = (host as HTMLElement).style;
  if (!style)
    throw new ThemeError(
      definition.name,
      '<tokens>',
      'mount',
      new Error('Theme host has no style declaration'),
    );
  const originalAttribute = host.hasAttribute('style');
  const keys = Array.from({ length: style.length }, (_, i) => style.item(i));
  const previous = Object.keys(definition.tokens).map((key) => {
    const variable = `--jcc-${key}`;
    return {
      variable,
      present: keys.includes(variable),
      value: style.getPropertyValue(variable),
      priority: style.getPropertyPriority(variable),
    };
  });
  let closed = false;
  const restore = (): void => {
    if (closed) return;
    closed = true;
    for (const value of previous) {
      if (value.present) style.setProperty(value.variable, value.value, value.priority);
      else style.removeProperty(value.variable);
    }
    if (!originalAttribute && style.length === 0) host.removeAttribute('style');
    else if (originalAttribute && !host.hasAttribute('style')) host.setAttribute('style', '');
  };
  try {
    for (const [key, value] of Object.entries(definition.tokens))
      style.setProperty(`--jcc-${key}`, String(value));
    return restore;
  } catch (error) {
    try {
      restore();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Theme token mount and rollback failed');
    }
    throw new ThemeError(definition.name, '<tokens>', 'mount', error);
  }
}

export class ThemeService implements ThemeContextProvider {
  private closed = false;
  private readonly groups = new Map<ThemeAsset, ImageGroup>();
  constructor(
    private readonly selected: ThemeDefinition<ThemeTokens, ThemeAssets>,
    private readonly onError?: (error: ThemeError) => void,
  ) {}
  forOwner<T extends ThemeTokens, A extends ThemeAssets>(
    owner: ComponentOwner,
    contract: ThemeDefinition<T, A>,
  ): ThemeContext<T, A> {
    owner.assertOpen();
    if (this.closed)
      throw new ThemeError(
        this.selected.name,
        '<theme>',
        'resolve',
        new Error('Theme service is disposed'),
      );
    if (contract[THEME] !== true || contract.defaultAssets !== this.selected.defaultAssets)
      throw new ThemeError(
        this.selected.name,
        '<theme>',
        'contract',
        new Error('Theme belongs to a different default contract'),
      );
    return Object.freeze({
      name: this.selected.name,
      tokens: this.selected.tokens as Readonly<T>,
      resolve: <K extends keyof A & string>(key: K) => {
        owner.assertOpen();
        if (this.closed || !Object.hasOwn(this.selected.assets, key))
          throw new ThemeError(
            this.selected.name,
            key,
            'resolve',
            new Error(this.closed ? 'Theme service is disposed' : 'Unknown theme asset key'),
          );
        return this.selected.assets[key]!;
      },
      load: <K extends keyof A & string>(key: K, options?: ThemeLoadOptions) =>
        this.load(owner, key, options),
    });
  }
  private group(key: string, asset: ThemeAsset): ImageGroup {
    let group = this.groups.get(asset);
    if (!group) {
      const resource: (ImageAssetEntry | AtlasAssetEntry) & { readonly optional: false } =
        asset.kind === 'image'
          ? { kind: 'image', url: asset.src, optional: false }
          : { kind: 'atlas', url: asset.src, optional: false, frames: { region: asset.frame } };
      group = defineAssetGroup({
        name: `theme:${this.selected.name}:${key}`,
        entries: { resource },
      });
      this.groups.set(asset, group);
    }
    return group;
  }
  private async load(
    owner: ComponentOwner,
    key: string,
    options: ThemeLoadOptions = {},
  ): Promise<ThemeImageLease> {
    const cancelled = () =>
      owner.disposed ||
      owner.cancellation.aborted ||
      this.closed ||
      options.signal?.aborted === true;
    let assets: AssetContext;
    let selected: ThemeAsset;
    try {
      owner.assertOpen();
      if (this.closed || !Object.hasOwn(this.selected.assets, key))
        throw new Error('Theme service is disposed or asset key is unknown');
      selected = this.selected.assets[key]!;
      assets = owner.getContext<AssetContextProvider>(ASSETS_CONTEXT).forOwner(owner);
    } catch (error) {
      throw new ThemeError(this.selected.name, key, 'load', error);
    }
    const acquire = async (
      asset: ThemeAsset,
      fallback: boolean,
      diagnostic?: ThemeError,
    ): Promise<ThemeImageLease> => {
      const signal = new Cancellation();
      let offOwner: Cleanup | undefined,
        offExternal: Cleanup | undefined,
        stopped = false;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        offOwner?.();
        offExternal?.();
        signal.cancel(
          options.signal?.reason ?? owner.cancellation.reason ?? new Error('Theme lease released'),
        );
      };
      offOwner = owner.cancellation.subscribe(stop);
      offExternal = options.signal?.subscribe(stop);
      try {
        const lease = await assets.load(this.group(key, asset), { signal });
        if (cancelled()) {
          stop();
          lease.release();
          throw new ThemeError(
            this.selected.name,
            key,
            'cancel',
            new Error('Theme owner exited before delivery'),
          );
        }
        const result = {
          kind: asset.kind,
          asset,
          fallback,
          ...(diagnostic ? { diagnostic } : {}),
          release() {
            try {
              stop();
            } finally {
              lease.release();
            }
          },
        };
        Object.defineProperty(result, 'image', {
          enumerable: true,
          get() {
            const value = lease.get('resource');
            return 'image' in value ? value.image : value;
          },
        });
        if (asset.kind === 'atlas-region')
          Object.defineProperty(result, 'frame', {
            enumerable: true,
            get() {
              lease.get('resource');
              return asset.frame;
            },
          });
        return Object.freeze(result) as ThemeImageLease;
      } catch (error) {
        stop();
        throw error;
      }
    };
    try {
      return await acquire(selected, false);
    } catch (error) {
      if (cancelled() || (error instanceof AssetError && error.operation === 'cancel'))
        throw new ThemeError(this.selected.name, key, 'cancel', error);
      const original = new ThemeError(this.selected.name, key, 'load', error);
      const fallback = this.selected.defaultAssets[key]!;
      if (selected === fallback) throw original;
      if (this.onError) reportApplicationError(original, () => this.onError!(original));
      if (cancelled()) throw new ThemeError(this.selected.name, key, 'cancel', original);
      try {
        return await acquire(fallback, true, original);
      } catch (fallbackError) {
        if (
          cancelled() ||
          (fallbackError instanceof AssetError && fallbackError.operation === 'cancel')
        )
          throw new ThemeError(this.selected.name, key, 'cancel', fallbackError);
        throw new ThemeError(
          this.selected.name,
          key,
          'fallback',
          new AggregateError(
            [original, fallbackError],
            'Theme override and default resource failed',
          ),
        );
      }
    }
  }
  dispose(): void {
    this.closed = true;
    this.groups.clear();
  }
}
