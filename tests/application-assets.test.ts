import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Cancellation, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineApplication,
  mountApplication,
  defineComponent,
  definePage,
  RouterOutlet,
  defineAssetGroup,
  createMemoryHistoryDriver,
  AssetError,
  ApplicationError,
  type AssetContext,
  type AssetGroupProgress,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const settle = () => new Promise<void>((done) => setImmediate(done));
function host() {
  const document = new Window().document as unknown as Document;
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}
const parse = (raw: unknown) => Number(raw);
const Data = defineAssetGroup({
  name: 'data',
  entries: { number: { kind: 'json', url: '/data', parse } },
});

test('public application/page assets share within an app, isolate across apps and release on the correct owner exit', async () => {
  const pageContexts: AssetContext[] = [];
  let factories = 0,
    loads = 0,
    releases = 0;
  const Root = defineComponent({
    selector: 'asset-app',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const Page = definePage({
    selector: 'asset-page',
    $template: '<p>page</p>',
    setup(c) {
      pageContexts.push(c.assets);
      return {};
    },
  });
  const Other = definePage({ selector: 'asset-other', $template: '<p>other</p>' });
  const group = defineAssetGroup({
    name: 'visuals',
    entries: { icon: { kind: 'image', url: '/icon' } },
  });
  const definition = defineApplication({
    root: Root,
    routes: [
      { path: '/', page: Page },
      { path: '/other', page: Other },
    ],
    router: { history: () => createMemoryHistoryDriver('/') },
    assets: {
      transport() {
        factories++;
        return {
          load: async () => {
            loads++;
            return { source: {} as CanvasImageSource, width: 16, height: 16 };
          },
          release() {
            releases++;
          },
        };
      },
    },
  });
  const first = await mountApplication(host(), definition),
    second = await mountApplication(host(), definition);
  const pageLease = await pageContexts[0]!.load(group),
    appLease = await first.assets!.load(group),
    otherAppLease = await second.assets!.load(group);
  assert.equal(factories, 2);
  assert.equal(loads, 2);
  assert.equal(pageLease.get('icon'), appLease.get('icon'));
  assert.notEqual(appLease.get('icon'), otherAppLease.get('icon'));
  await first.router.push('/other');
  await settle();
  assert.throws(() => pageLease.get('icon'), /released/);
  await assert.rejects(pageContexts[0]!.load(group), /owner is disposed/);
  assert.equal(appLease.get('icon').width, 16);
  assert.equal(releases, 0);
  first.dispose();
  await settle();
  assert.equal(releases, 1);
  assert.throws(() => appLease.get('icon'), /released/);
  assert.equal(otherAppLease.get('icon').height, 16);
  second.dispose();
  await settle();
  assert.equal(releases, 2);
});

test('same-owner retry retains successful failed-batch entries before releasing old holds, without replacing independent successful leases', async () => {
  const calls = new Map<string, number>();
  let releases = 0;
  const Root = defineComponent({
    selector: 'retry-asset-app',
    $template: '',
    setup(c) {
      return { assets: c.assets };
    },
  });
  const decode = (raw: unknown) => {
    if (typeof raw !== 'number') throw new Error('invalid data');
    return raw;
  };
  const group = defineAssetGroup({
    name: 'retry',
    entries: {
      good: { kind: 'json', url: '/good', parse: decode },
      bad: { kind: 'json', url: '/bad', parse: decode },
    },
  });
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      assets: {
        transport: () => ({
          async load(entry) {
            const count = (calls.get(entry.url) ?? 0) + 1;
            calls.set(entry.url, count);
            return entry.url === '/bad' && count === 1 ? 'broken' : 7;
          },
          release() {
            releases++;
          },
        }),
      },
    }),
  );
  const assets = app.root.exposed.assets;
  await assert.rejects(
    assets.load(group),
    (error) => error instanceof AssetError && error.key === 'bad',
  );
  const one = await assets.load(group),
    two = await assets.load(group);
  assert.equal(calls.get('/good'), 1);
  assert.equal(calls.get('/bad'), 2);
  assert.equal(releases, 1);
  one.release();
  assert.throws(() => one.get('good'), /released/);
  assert.equal(two.get('good'), 7);
  app.dispose();
  await settle();
  assert.equal(releases, 3);
  assert.throws(() => two.get('bad'), /released/);
});

test('page exit cancels a pending public load immediately and late old results cannot write to a new page generation', async () => {
  const contexts: AssetContext[] = [],
    gates: ((raw: unknown) => void)[] = [],
    released: unknown[] = [],
    progress: AssetGroupProgress[] = [];
  const Root = defineComponent({
    selector: 'cancel-asset-app',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const Page = definePage({
    selector: 'cancel-asset-page',
    $template: '',
    setup(c) {
      contexts.push(c.assets);
      return {};
    },
  });
  const Other = definePage({ selector: 'cancel-asset-other', $template: '' });
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      routes: [
        { path: '/', page: Page },
        { path: '/other', page: Other },
      ],
      router: { history: () => createMemoryHistoryDriver('/') },
      assets: {
        transport: () => ({
          load: () =>
            new Promise<unknown>((done) => {
              gates.push(done);
            }),
          release(_entry, raw) {
            released.push(raw);
          },
        }),
      },
    }),
  );
  const old = contexts[0]!.load(Data, {
    onProgress: (p) => {
      progress.push(p);
    },
  });
  const rejected = assert.rejects(
    old,
    (error) => error instanceof AssetError && error.operation === 'cancel',
  );
  await app.router.push('/other');
  await rejected;
  const count = progress.length;
  await app.router.push('/');
  const current = contexts[1]!.load(Data);
  assert.equal(gates.length, 2);
  gates[1]!(9);
  const lease = await current;
  gates[0]!(3);
  await settle();
  assert.equal(lease.get('number'), 9);
  assert.equal(progress.length, count);
  assert.deepEqual(released, [3]);
  app.dispose();
  await settle();
  assert.deepEqual(released, [3, 9]);
});

test('missing/failed assets configuration reports clearly, restores the host and leaves it reusable', async () => {
  const errors: ApplicationError[] = [];
  const Root = defineComponent({
    selector: 'configured-asset-app',
    $template: '',
    setup(c) {
      return { assets: c.assets };
    },
  });
  const element = host();
  element.innerHTML = '<em>original</em>';
  const original = element.firstChild;
  await assert.rejects(
    mountApplication(element, defineApplication({ root: Root })),
    /Missing component context: assets/,
  );
  await assert.rejects(
    mountApplication(
      element,
      defineApplication({
        root: Root,
        assets: {
          transport() {
            throw new Error('transport factory failed');
          },
        },
        onError: (error) => {
          errors.push(error);
        },
      }),
    ),
    /transport factory failed/,
  );
  assert.equal(errors.length, 1);
  assert.equal(element.firstChild, original);
  const app = await mountApplication(
    element,
    defineApplication({ root: Root, assets: { transport: () => ({ load: async () => 1 }) } }),
  );
  const lease = await app.root.exposed.assets.load(Data);
  assert.equal(lease.get('number'), 1);
  app.dispose();
  assert.equal(element.firstChild, original);
});

test('public explicit signals cancel only their own requests and release delivered leases without waiting for owner exit', async () => {
  let release!: (raw: unknown) => void,
    transportSignal!: CancellationSignal,
    released = 0;
  const Root = defineComponent({ selector: 'signal-asset-app', $template: '' });
  const app = await mountApplication(
    host(),
    defineApplication({
      root: Root,
      assets: {
        transport: () => ({
          load(_entry, signal) {
            transportSignal = signal;
            return new Promise<unknown>((done) => {
              release = done;
            });
          },
          release() {
            released++;
          },
        }),
      },
    }),
  );
  const firstSignal = new Cancellation(),
    secondSignal = new Cancellation();
  const first = app.assets!.load(Data, { signal: firstSignal }),
    second = app.assets!.load(Data, { signal: secondSignal });
  const rejected = assert.rejects(
    first,
    (error) => error instanceof AssetError && error.operation === 'cancel',
  );
  firstSignal.cancel();
  await rejected;
  assert.equal(transportSignal.aborted, false);
  release(6);
  const lease = await second;
  assert.equal(lease.get('number'), 6);
  secondSignal.cancel();
  await settle();
  assert.equal(released, 1);
  assert.throws(() => lease.get('number'), /released/);
  app.dispose();
  await settle();
  assert.equal(released, 1);
});
