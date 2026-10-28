import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineTheme,
  extendTheme,
  defineComponent,
  defineApplication,
  mountApplication,
  ThemeError,
  type ApplicationError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Base = defineTheme({
  name: 'base',
  tokens: { accent: 'red' },
  assets: {
    pause: { kind: 'image', src: '/pause.png' },
    coin: {
      kind: 'atlas-region',
      src: '/sheet.png',
      frame: { x: 16, y: 0, width: 16, height: 16 },
    },
  },
});
const Root = defineComponent({
  selector: 'theme-load-app',
  $template: '<img ref="pause">',
  setup(c) {
    return { theme: c.useTheme(Base) };
  },
  onMount(c) {
    c.element('pause').setAttribute('src', c.exposed.theme.resolve('pause').src);
  },
});
function host() {
  const document = new Window().document as unknown as Document;
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}
const image = () => ({ source: {} as CanvasImageSource, width: 32, height: 16 });
const settle = () => new Promise<void>((done) => setImmediate(done));

test('selected semantic assets drive DOM URLs and shared Canvas image leases, with whole atlas-to-image replacement and owner cleanup', async () => {
  const selected = extendTheme(Base, {
    name: 'forest',
    assets: {
      pause: { kind: 'image', src: '/forest-pause.png' },
      coin: { kind: 'image', src: '/forest-coin.png' },
    },
  });
  const calls: string[] = [],
    released: string[] = [];
  const element = host();
  const app = await mountApplication(
    element,
    defineApplication({
      root: Root,
      theme: selected,
      assets: {
        transport: () => ({
          async load(entry) {
            calls.push(entry.url);
            return image();
          },
          release(entry) {
            released.push(entry.url);
          },
        }),
      },
    }),
  );
  const theme = app.root.exposed.theme;
  assert.equal(element.querySelector('img')!.getAttribute('src'), '/forest-pause.png');
  const pause = await theme.load('pause'),
    coin = await theme.load('coin'),
    shared = await app.useTheme(Base).load('coin');
  assert.equal(coin.kind, 'image');
  assert.equal(Object.hasOwn(coin, 'frame'), false);
  assert.equal(coin.asset.src, '/forest-coin.png');
  assert.equal(coin.fallback, false);
  assert.equal(coin.image.source, shared.image.source);
  assert.deepEqual(calls, ['/forest-pause.png', '/forest-coin.png']);
  coin.release();
  assert.throws(() => coin.image, /released/);
  assert.equal(shared.image.width, 32);
  app.dispose();
  await settle();
  assert.deepEqual(released.sort(), ['/forest-coin.png', '/forest-pause.png']);
  assert.throws(() => pause.image, /released/);
  assert.throws(() => shared.image, /released/);
});

test('a failed image override falls back once to the original atlas with diagnostics and validated frame bounds', async () => {
  const selected = extendTheme(Base, {
    name: 'broken',
    assets: { coin: { kind: 'image', src: '/broken.png' } },
  });
  const calls: string[] = [],
    errors: ApplicationError[] = [];
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      theme: selected,
      assets: {
        transport: () => ({
          async load(entry) {
            calls.push(entry.url);
            if (entry.url === '/broken.png') throw new Error('missing override');
            return image();
          },
        }),
      },
      onError: (error) => {
        errors.push(error);
      },
    }),
  );
  const theme = app.root.exposed.theme,
    lease = await theme.load('coin');
  assert.equal(lease.fallback, true);
  assert.equal(lease.kind, 'atlas-region');
  if (lease.kind === 'atlas-region')
    assert.deepEqual(lease.frame, { x: 16, y: 0, width: 16, height: 16 });
  assert.equal(lease.asset.src, '/sheet.png');
  assert.ok(lease.diagnostic instanceof ThemeError);
  assert.equal(theme.resolve('coin').src, '/broken.png');
  assert.deepEqual(calls, ['/broken.png', '/sheet.png']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.module, 'theme-assets');
  app.dispose();
  assert.throws(() => lease.image, /released/);
});

test('invalid actual atlas bounds can fall back to an image, while two failed sources reject without retry loops', async () => {
  const selected = extendTheme(Base, {
    name: 'bounds',
    assets: {
      pause: {
        kind: 'atlas-region',
        src: '/small.png',
        frame: { x: 24, y: 0, width: 16, height: 16 },
      },
    },
  });
  const calls: string[] = [],
    released: string[] = [];
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      theme: selected,
      assets: {
        transport: () => ({
          async load(entry) {
            calls.push(entry.url);
            return image();
          },
          release(entry) {
            released.push(entry.url);
          },
        }),
      },
    }),
  );
  const lease = await app.root.exposed.theme.load('pause');
  assert.equal(lease.kind, 'image');
  assert.equal(lease.fallback, true);
  assert.deepEqual(calls, ['/small.png', '/pause.png']);
  assert.deepEqual(released, ['/small.png']);
  app.dispose();
  await settle();
  assert.deepEqual(released, ['/small.png', '/pause.png']);
  let attempts = 0;
  const broken = extendTheme(Base, {
    name: 'broken-all',
    assets: { pause: { kind: 'image', src: '/absent.png' } },
  });
  const failing = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      theme: broken,
      assets: {
        transport: () => ({
          load: async () => {
            attempts++;
            throw new Error('missing');
          },
        }),
      },
    }),
  );
  await assert.rejects(
    failing.root.exposed.theme.load('pause'),
    (error) =>
      error instanceof ThemeError &&
      error.operation === 'fallback' &&
      error.cause instanceof AggregateError &&
      error.cause.errors.length === 2,
  );
  assert.equal(attempts, 2);
  failing.dispose();
});

test('explicit cancellation and owner exit stop fallback attempts and release late images exactly once', async () => {
  const selected = extendTheme(Base, {
    name: 'cancelled',
    assets: { coin: { kind: 'image', src: '/pending.png' } },
  });
  const calls: string[] = [],
    gates: ((raw: unknown) => void)[] = [];
  let released = 0;
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      theme: selected,
      assets: {
        transport: () => ({
          load(entry) {
            calls.push(entry.url);
            return new Promise<unknown>((done) => {
              gates.push(done);
            });
          },
          release() {
            released++;
          },
        }),
      },
    }),
  );
  const cancellation = new Cancellation();
  const first = app.root.exposed.theme.load('coin', { signal: cancellation });
  const rejected = assert.rejects(
    first,
    (error) => error instanceof ThemeError && error.operation === 'cancel',
  );
  cancellation.cancel();
  await rejected;
  const pending = app.root.exposed.theme.load('coin');
  const exiting = assert.rejects(
    pending,
    (error) => error instanceof ThemeError && error.operation === 'cancel',
  );
  app.dispose();
  await exiting;
  gates.forEach((resolve) => resolve(image()));
  await settle();
  assert.deepEqual(calls, ['/pending.png', '/pending.png']);
  assert.equal(released, 2);
});
