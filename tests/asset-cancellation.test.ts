import assert from 'node:assert/strict';
import test from 'node:test';
import { Cancellation, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineAssetGroup,
  AssetError,
  type AssetGroupProgress,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AssetLoader } from '../packages/app/runtime/asset-loader.js';
const settle = () => new Promise<void>((done) => setImmediate(done));
const parse = (raw: unknown) => Number(raw);
const Group = defineAssetGroup({
  name: 'shared',
  entries: { data: { kind: 'json', url: '/data', parse } },
});

test('one group cancels immediately while another retains the same in-flight transport and receives a valid lease', async () => {
  let resolve!: (raw: unknown) => void,
    signal!: CancellationSignal,
    released = 0,
    calls = 0;
  const loader = new AssetLoader({
    load(_entry, current) {
      calls++;
      signal = current;
      return new Promise<unknown>((done) => {
        resolve = done;
      });
    },
    release() {
      released++;
    },
  });
  const cancellation = new Cancellation(),
    progress: AssetGroupProgress[] = [];
  const first = loader.start(Group, {
    signal: cancellation,
    onProgress: (p) => {
      progress.push(p);
    },
  });
  const second = loader.start(Group);
  const rejected = assert.rejects(
    first.ready,
    (error) => error instanceof AssetError && error.operation === 'cancel',
  );
  cancellation.cancel('left-page');
  await rejected;
  assert.equal(signal.aborted, false);
  assert.equal(calls, 1);
  assert.deepEqual(progress.at(-1), {
    status: 'cancelled',
    total: 1,
    completed: 0,
    failed: 0,
    pending: 1,
  });
  const count = progress.length;
  resolve(8);
  const lease = await second.ready;
  assert.equal(lease.get('data'), 8);
  assert.equal(progress.length, count);
  assert.equal(released, 0);
  lease.release();
  lease.release();
  await settle();
  assert.equal(released, 1);
  assert.throws(() => lease.get('data'), /released/);
  loader.dispose();
});

test('last-holder cancellation removes queued work and releases a late raw result once without notifying the old group', async () => {
  let resolve!: (raw: unknown) => void, signal!: CancellationSignal;
  const calls: string[] = [],
    released: unknown[] = [],
    progress: AssetGroupProgress[] = [];
  const loader = new AssetLoader(
    {
      load(entry, current) {
        calls.push(entry.url);
        signal = current;
        return new Promise<unknown>((done) => {
          resolve = done;
        });
      },
      release(_entry, raw) {
        released.push(raw);
      },
    },
    { concurrency: 1 },
  );
  const group = defineAssetGroup({
    name: 'cancelled',
    entries: {
      first: { kind: 'json', url: '/first', parse },
      queued: { kind: 'json', url: '/queued', parse },
    },
  });
  const cancellation = new Cancellation();
  const batch = loader.start(group, {
    signal: cancellation,
    onProgress: (p) => {
      progress.push(p);
    },
  });
  const rejected = assert.rejects(batch.ready, /cancel/);
  cancellation.cancel();
  await rejected;
  assert.equal(signal.aborted, true);
  const count = progress.length;
  resolve(10);
  await settle();
  assert.deepEqual(calls, ['/first']);
  assert.deepEqual(released, [10]);
  assert.equal(progress.length, count);
  batch.release();
  loader.dispose();
  await settle();
  assert.equal(released.length, 1);
});

test('pre-aborted and reentrant cancellation do not start extra entries, and loader disposal invalidates ready leases', async () => {
  let calls = 0,
    released = 0;
  const pre = new Cancellation();
  pre.cancel();
  const loader = new AssetLoader({
    load: async () => {
      calls++;
      return 1;
    },
    release() {
      released++;
    },
  });
  const skipped = loader.start(Group, { signal: pre });
  await assert.rejects(skipped.ready, /cancel/);
  assert.equal(calls, 0);
  const lease = await loader.start(Group).ready;
  loader.dispose();
  await settle();
  assert.throws(() => lease.get('data'), /released/);
  assert.equal(released, 1);
  const cancellation = new Cancellation();
  const reentrant = new AssetLoader({
    load: async () => {
      calls++;
      cancellation.cancel();
      return 2;
    },
    release() {
      released++;
    },
  });
  const group = defineAssetGroup({
    name: 'reentrant',
    entries: {
      one: { kind: 'json', url: '/one', parse },
      two: { kind: 'json', url: '/two', parse },
    },
  });
  const batch = reentrant.start(group, { signal: cancellation });
  await assert.rejects(batch.ready, /cancel/);
  await settle();
  assert.equal(calls, 2);
  assert.equal(released, 2);
  reentrant.dispose();
});

test('cancelling the supplied signal after success releases the lease and blocks further reads', async () => {
  let released = 0;
  const loader = new AssetLoader({
    load: async () => 5,
    release() {
      released++;
    },
  });
  const cancellation = new Cancellation(),
    progress: AssetGroupProgress[] = [];
  const batch = loader.start(Group, {
    signal: cancellation,
    onProgress: (p) => {
      progress.push(p);
    },
  });
  const lease = await batch.ready;
  assert.equal(lease.get('data'), 5);
  const count = progress.length;
  cancellation.cancel();
  await settle();
  assert.equal(released, 1);
  assert.equal(progress.length, count);
  assert.throws(() => lease.get('data'), /released/);
  lease.release();
  loader.dispose();
  await settle();
  assert.equal(released, 1);
});
