import {
  defineAssetGroup,
  type AssetValue,
  type AssetGroupLease,
  type AssetContext,
  type AssetGroupProgress,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const group = defineAssetGroup({
  name: 'typed',
  entries: {
    levels: {
      kind: 'json',
      url: '/levels.json',
      parse: (raw: unknown) => ({ count: Number(raw) }),
    },
    image: { kind: 'image', url: '/image.png' },
    optional: { kind: 'audio', url: '/sound.ogg', optional: true },
    atlas: {
      kind: 'atlas',
      url: '/sheet.png',
      frames: { coin: { x: 0, y: 0, width: 16, height: 16 } },
    },
  },
});
function consume(
  value: AssetValue<typeof group.entries.levels>,
  atlas: AssetValue<typeof group.entries.atlas>,
  optional: AssetValue<typeof group.entries.optional>,
) {
  const count: number = value.count;
  // @ts-expect-error decoded JSON is deeply readonly
  value.count = 2;
  atlas.frames.coin.width;
  // @ts-expect-error atlas frame keys remain narrowed
  atlas.frames.missing;
  // @ts-expect-error optional resource reads require a presence check
  optional.byteLength;
  void count;
}
defineAssetGroup({
  name: 'missing',
  entries: {
    // @ts-expect-error JSON requires a decoder
    json: { kind: 'json', url: '/data.json' },
  },
});
defineAssetGroup({
  name: 'async',
  entries: {
    // @ts-expect-error JSON decoders must be synchronous
    json: { kind: 'json', url: '/data.json', parse: async () => ({ count: 1 }) },
  },
});
void consume;
function leaseTypes(lease: AssetGroupLease<typeof group.entries>) {
  const value: number = lease.get('levels').count;
  // @ts-expect-error lease keys remain narrowed
  lease.get('missing');
  // @ts-expect-error optional lease value requires a presence check
  lease.get('optional').byteLength;
  void value;
}
void leaseTypes;
async function contextTypes(context: AssetContext) {
  const lease = await context.load(group);
  const count: number = lease.get('levels').count;
  // @ts-expect-error context.load retains logical key types
  lease.get('missing');
  lease.release();
  void count;
}
void contextTypes;
const idle: AssetGroupProgress = { status: 'idle', total: 0, completed: 0, failed: 0, pending: 0 };
void idle;
