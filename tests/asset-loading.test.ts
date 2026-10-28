import assert from 'node:assert/strict';
import test from 'node:test';
import { defineAssetGroup, AssetError } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AssetLoader } from '../packages/app/runtime/asset-loader.js';
import type { AssetGroupProgress } from '../packages/app/runtime/asset-types.js';
const settle = () => new Promise<void>((done) => setImmediate(done));

test('one pool bounds all groups, merges aliases and reports fixed item progress while retaining shared resources', async () => {
  const gates = new Map<string, (raw: unknown) => void>(),
    calls: string[] = [],
    released: string[] = [];
  let active = 0,
    peak = 0;
  const loader = new AssetLoader(
    {
      load(entry) {
        active++;
        peak = Math.max(peak, active);
        calls.push(entry.url);
        return new Promise<unknown>((done) => {
          gates.set(entry.url, done);
        }).finally(() => {
          active--;
        });
      },
      release(entry) {
        released.push(entry.url);
      },
    },
    { concurrency: 2 },
  );
  const parse = (raw: unknown) => ({ number: Number(raw) });
  const firstGroup = defineAssetGroup({
    name: 'first',
    entries: {
      a: { kind: 'json', url: '/a', parse },
      b: { kind: 'json', url: '/b', parse },
      c: { kind: 'json', url: '/c', parse },
      d: { kind: 'json', url: '/d', parse },
      alias: { kind: 'json', url: '/a', parse },
    },
  });
  const secondGroup = defineAssetGroup({
    name: 'second',
    entries: {
      shared: { kind: 'json', url: '/a', parse },
      e: { kind: 'json', url: '/e', parse },
    },
  });
  const progress: AssetGroupProgress[] = [];
  const first = loader.start(firstGroup, {
    onProgress: (value) => {
      progress.push(value);
    },
  });
  const second = loader.start(secondGroup);
  assert.deepEqual(calls, ['/a', '/b']);
  while (gates.size) {
    const [url, done] = gates.entries().next().value!;
    gates.delete(url);
    done(7);
    await settle();
  }
  const [one, two] = await Promise.all([first.ready, second.ready]);
  assert.equal(peak, 2);
  assert.equal(calls.length, 5);
  assert.equal(one.get('a'), one.get('alias'));
  assert.equal(one.get('a'), two.get('shared'));
  assert.ok(
    progress.every(
      (p) => p.total === 5 && p.completed + p.failed + p.pending === 5 && Object.isFrozen(p),
    ),
  );
  assert.deepEqual(progress.at(-1), {
    status: 'ready',
    total: 5,
    completed: 5,
    failed: 0,
    pending: 0,
  });
  first.release();
  first.release();
  await settle();
  assert.equal(released.includes('/a'), false);
  second.release();
  await settle();
  assert.deepEqual([...released].sort(), [...calls].sort());
  loader.dispose();
});

test('required decode failures retain source diagnostics, optional failures stay explicit, and retry reuses successful items', async () => {
  const calls = new Map<string, number>(),
    released: string[] = [];
  const parse = (raw: unknown) => {
    if (typeof raw !== 'number') throw new Error('Expected numeric JSON');
    return { value: raw };
  };
  const loader = new AssetLoader({
    async load(entry) {
      const attempt = (calls.get(entry.url) ?? 0) + 1;
      calls.set(entry.url, attempt);
      return (entry.url === '/bad' && attempt === 1) || entry.url === '/optional' ? 'invalid' : 3;
    },
    release(entry) {
      released.push(entry.url);
    },
  });
  const group = defineAssetGroup({
    name: 'required',
    entries: {
      good: { kind: 'json', url: '/good', parse },
      bad: { kind: 'json', url: '/bad', parse },
    },
  });
  const progress: AssetGroupProgress[] = [];
  const failed = loader.start(group, {
    onProgress: (p) => {
      progress.push(p);
    },
  });
  await assert.rejects(
    failed.ready,
    (error) =>
      error instanceof AssetError &&
      error.group === 'required' &&
      error.key === 'bad' &&
      error.url === '/bad' &&
      error.operation === 'decode',
  );
  assert.deepEqual(progress.at(-1), {
    status: 'failed',
    total: 2,
    completed: 1,
    failed: 1,
    pending: 0,
  });
  const retry = loader.start(group);
  await retry.ready;
  assert.equal(calls.get('/good'), 1);
  assert.equal(calls.get('/bad'), 2);
  failed.release();
  retry.release();
  await settle();
  assert.equal(released.filter((url) => url === '/bad').length, 2);
  const optional = defineAssetGroup({
    name: 'optional',
    entries: { maybe: { kind: 'json', url: '/optional', parse, optional: true } },
  });
  const statuses: AssetGroupProgress[] = [];
  const batch = loader.start(optional, {
    onProgress: (p) => {
      statuses.push(p);
    },
  });
  assert.equal((await batch.ready).get('maybe'), undefined);
  assert.deepEqual(statuses.at(-1), {
    status: 'ready',
    total: 1,
    completed: 0,
    failed: 1,
    pending: 0,
  });
  batch.release();
  loader.dispose();
});

test('decoder identities and atlas frame tables distinguish parsed keys, and progress observer failure does not stall other groups', async () => {
  let calls = 0,
    released = 0;
  const loader = new AssetLoader({
    async load(entry) {
      calls++;
      return entry.kind === 'atlas'
        ? { source: {} as CanvasImageSource, width: 32, height: 16 }
        : 2;
    },
    release() {
      released++;
    },
  });
  const first = defineAssetGroup({
    name: 'one',
    entries: { value: { kind: 'json', url: '/same', parse: (raw: unknown) => Number(raw) } },
  });
  const second = defineAssetGroup({
    name: 'two',
    entries: {
      value: { kind: 'json', url: '/same', parse: (raw: unknown) => ({ value: Number(raw) }) },
    },
  });
  const sheets = defineAssetGroup({
    name: 'sheets',
    entries: {
      left: {
        kind: 'atlas',
        url: '/sheet',
        frames: { coin: { x: 0, y: 0, width: 16, height: 16 } },
      },
      right: {
        kind: 'atlas',
        url: '/sheet',
        frames: { coin: { x: 16, y: 0, width: 16, height: 16 } },
      },
    },
  });
  const a = loader.start(first),
    b = loader.start(second),
    c = loader.start(sheets);
  assert.equal((await a.ready).get('value'), 2);
  assert.deepEqual((await b.ready).get('value'), { value: 2 });
  const sheet = await c.ready;
  assert.notEqual(sheet.get('left'), sheet.get('right'));
  assert.equal(calls, 4);
  const observed = loader.start(first, {
    async onProgress() {
      throw new Error('observer failed');
    },
  });
  await assert.rejects(
    observed.ready,
    (error) => error instanceof AssetError && error.operation === 'progress',
  );
  observed.release();
  a.release();
  b.release();
  c.release();
  await settle();
  assert.equal(released, 4);
  loader.dispose();
});

test('asynchronous transport cleanup errors preserve resource source and do not release a resource twice', async () => {
  const errors: unknown[] = [];
  let released = 0;
  const loader = new AssetLoader(
    {
      load: async () => 1,
      async release() {
        released++;
        throw new Error('cleanup failed');
      },
    },
    {
      onReleaseError: (error) => {
        errors.push(error);
      },
    },
  );
  const group = defineAssetGroup({
    name: 'cleanup',
    entries: { data: { kind: 'json', url: '/data', parse: (raw: unknown) => Number(raw) } },
  });
  const batch = loader.start(group);
  await batch.ready;
  batch.release();
  batch.release();
  await settle();
  assert.equal(released, 1);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof AssetError);
  const error = errors[0] as AssetError;
  assert.equal(error.group, 'cleanup');
  assert.equal(error.key, 'data');
  assert.equal(error.url, '/data');
  assert.equal(error.operation, 'release');
  loader.dispose();
  await settle();
  assert.equal(released, 1);
});
