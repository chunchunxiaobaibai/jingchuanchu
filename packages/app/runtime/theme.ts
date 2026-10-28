import {
  THEME,
  ThemeError,
  type ThemeTokens,
  type ThemeAssets,
  type ThemeAsset,
  type ThemeDefinition,
  type ThemeOverrides,
  type ThemeTokenValues,
  type ThemeAssetValues,
} from './theme-types.js';

function record(value: unknown): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Expected a plain theme record');
}
function name(value: string): void {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value))
    throw new Error('Theme name/key/src must be nonempty');
}
function token(key: string, value: unknown): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) throw new Error('Token key must be a CSS identifier');
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error('Token must be a string or finite number');
}
function asset(value: ThemeAsset): ThemeAsset {
  if (!value || (value.kind !== 'image' && value.kind !== 'atlas-region'))
    throw new Error('Unknown theme asset kind');
  name(value.src);
  if (value.kind === 'image') return Object.freeze({ kind: 'image', src: value.src });
  const frame = value.frame;
  if (!frame) throw new Error('Atlas region requires frame');
  for (const field of ['x', 'y', 'width', 'height'] as const)
    if (
      !Number.isSafeInteger(frame[field]) ||
      frame[field] < (field === 'x' || field === 'y' ? 0 : 1)
    )
      throw new Error(`Invalid atlas frame ${field}`);
  return Object.freeze({
    kind: 'atlas-region',
    src: value.src,
    frame: Object.freeze({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }),
  });
}

export function defineTheme<const T extends ThemeTokens, const A extends ThemeAssets>(options: {
  readonly name: string;
  readonly tokens: T;
  readonly assets: A;
}): ThemeDefinition<ThemeTokenValues<T>, ThemeAssetValues<A>> {
  try {
    name(options.name);
    record(options.tokens);
    record(options.assets);
  } catch (error) {
    throw new ThemeError(options.name, '<theme>', 'define', error);
  }
  const tokens: Record<string, string | number> = Object.create(null),
    assets: Record<string, ThemeAsset> = Object.create(null);
  for (const [key, value] of Object.entries(options.tokens)) {
    try {
      token(key, value);
      tokens[key] = value;
    } catch (error) {
      throw new ThemeError(options.name, `tokens.${key}`, 'define', error);
    }
  }
  for (const [key, value] of Object.entries(options.assets)) {
    try {
      name(key);
      assets[key] = asset(value);
    } catch (error) {
      throw new ThemeError(options.name, `assets.${key}`, 'define', error);
    }
  }
  return Object.freeze({
    [THEME]: true,
    name: options.name,
    tokens: Object.freeze(tokens),
    assets: Object.freeze(assets),
    defaultAssets: assets,
  }) as ThemeDefinition<ThemeTokenValues<T>, ThemeAssetValues<A>>;
}

export function extendTheme<T extends ThemeTokens, A extends ThemeAssets>(
  base: ThemeDefinition<T, A>,
  overrides: ThemeOverrides<NoInfer<T>, NoInfer<A>>,
): ThemeDefinition<T, A> {
  try {
    if (base[THEME] !== true) throw new Error('Expected defineTheme(...)');
    name(overrides.name);
    if (overrides.tokens !== undefined) record(overrides.tokens);
    if (overrides.assets !== undefined) record(overrides.assets);
  } catch (error) {
    throw new ThemeError(overrides.name, '<theme>', 'extend', error);
  }
  const tokens: Record<string, string | number> = { ...base.tokens },
    assets: Record<string, ThemeAsset> = { ...base.assets };
  for (const [key, value] of Object.entries(overrides.tokens ?? {})) {
    try {
      if (!Object.hasOwn(base.tokens, key)) throw new Error('Unknown token key');
      token(key, value);
      if (typeof value !== typeof base.tokens[key])
        throw new Error('Token override must preserve string/number category');
      tokens[key] = value as string | number;
    } catch (error) {
      throw new ThemeError(overrides.name, `tokens.${key}`, 'extend', error);
    }
  }
  for (const [key, value] of Object.entries(overrides.assets ?? {})) {
    try {
      if (!Object.hasOwn(base.assets, key)) throw new Error('Unknown asset key');
      assets[key] = asset(value as ThemeAsset);
    } catch (error) {
      throw new ThemeError(overrides.name, `assets.${key}`, 'extend', error);
    }
  }
  return Object.freeze({
    [THEME]: true,
    name: overrides.name,
    tokens: Object.freeze(tokens),
    assets: Object.freeze(assets),
    defaultAssets: base.defaultAssets,
  }) as ThemeDefinition<T, A>;
}
