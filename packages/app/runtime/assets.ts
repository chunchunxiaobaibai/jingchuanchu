import { snapshot } from '../state.js';
import {
  ASSET_GROUP,
  AssetError,
  type AssetEntries,
  type AssetEntry,
  type AssetGroup,
  type SyncAssetEntries,
  type AtlasFrames,
  type AssetImage,
  type DecodedAsset,
} from './asset-types.js';

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f]/.test(value);
}
function frames(value: unknown): AtlasFrames {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Atlas frames must be a record');
  const result = snapshot(value) as AtlasFrames;
  for (const [name, frame] of Object.entries(result)) {
    if (!text(name) || !frame || typeof frame !== 'object')
      throw new Error('Invalid atlas frame name/data');
    for (const key of ['x', 'y', 'width', 'height'] as const)
      if (!Number.isSafeInteger(frame[key]) || frame[key] < (key === 'x' || key === 'y' ? 0 : 1))
        throw new Error(`Invalid atlas frame ${name}.${key}`);
  }
  return result;
}
export function defineAssetGroup<const E extends AssetEntries>(options: {
  readonly name: string;
  readonly entries: E & SyncAssetEntries<E>;
}): AssetGroup<E> {
  const name = typeof options.name === 'string' ? options.name : '<group>';
  const entries: Record<string, AssetEntry> = Object.create(null);
  try {
    if (!text(options.name)) throw new Error('Asset group name must be nonempty');
    if (
      !options.entries ||
      typeof options.entries !== 'object' ||
      Array.isArray(options.entries) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options.entries))
    )
      throw new Error('Asset entries must be a record');
  } catch (error) {
    throw new AssetError(name, '<group>', '', 'define', error);
  }
  for (const [key, entry] of Object.entries(options.entries as AssetEntries)) {
    try {
      if (!text(key)) throw new Error('Asset key must be nonempty');
      if (!entry || !['image', 'atlas', 'audio', 'json'].includes(entry.kind))
        throw new Error('Unknown asset kind');
      if (!text(entry.url)) throw new Error('Asset URL must be nonempty');
      if (entry.optional !== undefined && typeof entry.optional !== 'boolean')
        throw new Error('optional must be boolean');
      if (entry.kind === 'json' && typeof entry.parse !== 'function')
        throw new Error('JSON requires a parse/decoder');
      entries[key] = Object.freeze({
        ...entry,
        ...(entry.kind === 'atlas' ? { frames: frames(entry.frames) } : {}),
      }) as AssetEntry;
    } catch (error) {
      throw new AssetError(
        name,
        key,
        typeof entry?.url === 'string' ? entry.url : '',
        'define',
        error,
      );
    }
  }
  return Object.freeze({
    [ASSET_GROUP]: true,
    name,
    entries: Object.freeze(entries),
  }) as AssetGroup<E>;
}

function image(raw: unknown): AssetImage {
  const value = raw as AssetImage | null;
  if (
    !value ||
    !value.source ||
    typeof value.source !== 'object' ||
    !Number.isSafeInteger(value.width) ||
    value.width <= 0 ||
    !Number.isSafeInteger(value.height) ||
    value.height <= 0
  )
    throw new Error('Image adapter must return source and positive integer dimensions');
  // Preserve the host image object; never structuredClone or freeze a live CanvasImageSource.
  return Object.freeze({ source: value.source, width: value.width, height: value.height });
}

/** Internal decoder stage. Transport/concurrency and leases are implemented in T17/T18. */
export function decodeAssetEntry<E extends AssetEntries, K extends keyof E & string>(
  group: AssetGroup<E>,
  key: K,
  raw: unknown,
): DecodedAsset<E[K]> {
  const entry = group.entries[key] as AssetEntry | undefined;
  try {
    if (group[ASSET_GROUP] !== true) throw new Error('Expected defineAssetGroup(...)');
    if (!entry) throw new Error(`Unknown asset key: ${key}`);
    let value: unknown;
    if (entry.kind === 'json') {
      value = entry.parse(raw);
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw new Error('JSON decoders must be synchronous');
      }
      value = snapshot(value);
    } else if (entry.kind === 'image') value = image(raw);
    else if (entry.kind === 'audio') {
      // This intrinsic getter checks the ArrayBuffer brand across host realms.
      Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(raw);
      value = raw;
    } else {
      const decoded = image(raw);
      for (const [name, frame] of Object.entries(entry.frames))
        if (frame.x + frame.width > decoded.width || frame.y + frame.height > decoded.height)
          throw new Error(`Atlas frame ${name} exceeds image dimensions`);
      value = Object.freeze({ image: decoded, frames: entry.frames });
    }
    return value as DecodedAsset<E[K]>;
  } catch (error) {
    throw new AssetError(group.name, key, entry?.url ?? '', 'decode', error);
  }
}
