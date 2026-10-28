import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  computed,
  signal,
  effect,
  batch,
  type ReadSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';

const flushed = () => new Promise<void>((resolve) => setImmediate(resolve));

test('upstream signals do not retain abandoned computed closures after scope disposal', () => {
  execFileSync(
    process.execPath,
    [
      '--expose-gc',
      '--conditions=source',
      '--import',
      'tsx',
      fileURLToPath(new URL('./fixtures/reactivity-retention.ts', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
});

test('signal owns a stable deeply readonly snapshot and compares the last input identity', () => {
  const input = { items: [{ score: 1 }] };
  const value = signal(input);
  const initial = value();
  assert.notStrictEqual(initial, input);
  assert.notStrictEqual(initial.items, input.items);
  assert.strictEqual(value(), initial);
  assert.equal(Reflect.set(initial.items[0]!, 'score', 9), false);
  assert.equal(Object.isFrozen(initial.items), true);
  input.items[0]!.score = 2;
  value.set(input);
  assert.strictEqual(value(), initial);
  assert.equal(value().items[0]!.score, 1);

  const replacement = { items: [{ score: 3 }] };
  value.set(replacement);
  assert.equal(value().items[0]!.score, 3);
  replacement.items[0]!.score = 4;
  assert.equal(value().items[0]!.score, 3);
  value.update((previous) => ({ items: [{ score: previous.items[0]!.score + 1 }] }));
  assert.equal(value().items[0]!.score, 4);
});

test('signal Object.is equality skips NaN and distinguishes signed zero without eager derivation', () => {
  const source = signal(NaN);
  let calls = 0;
  const derived = computed(() => {
    calls++;
    return source();
  });
  assert.equal(calls, 0);
  assert.equal(derived(), NaN);
  source.set(NaN);
  assert.equal(derived(), NaN);
  assert.equal(calls, 1);
  source.set(0);
  assert.equal(calls, 1);
  assert.equal(derived(), 0);
  source.set(-0);
  assert.equal(derived(), -0);
  assert.equal(calls, 3);
});

test('same object input does not invalidate computed even after caller mutation', () => {
  const input = { score: 1 };
  const source = signal(input);
  let calls = 0;
  const derived = computed(() => {
    calls++;
    return source().score;
  });
  assert.equal(derived(), 1);
  input.score = 2;
  source.set(input);
  assert.equal(derived(), 1);
  assert.equal(calls, 1);
  source.set({ score: 2 });
  assert.equal(derived(), 2);
  assert.equal(calls, 2);
});

test('computed caches its independent readonly data snapshot', () => {
  const source = signal(1);
  const output = { nested: { score: 1 }, list: [1] };
  let calls = 0;
  const derived = computed(() => {
    calls++;
    output.nested.score = source();
    return output;
  });
  const first = derived();
  assert.notStrictEqual(first, output);
  assert.equal(Object.isFrozen(first.nested), true);
  assert.equal(Object.isFrozen(first.list), true);
  assert.equal(Reflect.set(first.nested, 'score', 8), false);
  output.nested.score = 9;
  assert.strictEqual(derived(), first);
  assert.equal(first.nested.score, 1);
  source.set(2);
  assert.equal(derived().nested.score, 2);
  assert.equal(calls, 2);
});

test('computed tracks actual synchronous branches and removes stale dependencies', () => {
  const branch = signal(true);
  const left = signal(1);
  const right = signal(10);
  let calls = 0;
  const choice = computed(() => {
    calls++;
    return branch() ? left() : right();
  });
  assert.equal(choice(), 1);
  right.set(11);
  assert.equal(choice(), 1);
  assert.equal(calls, 1);
  branch.set(false);
  assert.equal(choice(), 11);
  left.set(2);
  assert.equal(choice(), 11);
  assert.equal(calls, 2);
  right.set(12);
  assert.equal(choice(), 12);
  assert.equal(calls, 3);
});

test('reads deferred beyond synchronous derivation do not become dependencies', async () => {
  const source = signal(0);
  let calls = 0;
  const derived = computed(() => {
    calls++;
    queueMicrotask(() => source());
    return 1;
  });
  assert.equal(derived(), 1);
  await Promise.resolve();
  source.set(1);
  assert.equal(derived(), 1);
  assert.equal(calls, 1);
});

test('nested and diamond computed reads reflect every synchronous write and retain cache', () => {
  const source = signal(1);
  const left = computed(() => source() * 2);
  const right = computed(() => source() + 10);
  let calls = 0;
  const total = computed(() => {
    calls++;
    return left() + right();
  });
  assert.equal(total(), 13);
  assert.equal(total(), 13);
  source.set(2);
  assert.equal(total(), 16);
  source.update((previous) => previous + 1);
  assert.equal(total(), 19);
  assert.equal(calls, 3);
});

test('failed derivation can retry and does not leak its tracking context', () => {
  const source = signal(0);
  const unrelated = signal(0);
  let calls = 0;
  const derived = computed(() => {
    calls++;
    if (source() === 0) throw new Error('derive failed');
    return source();
  });
  assert.throws(derived, /derive failed/);
  unrelated();
  source.set(1);
  assert.equal(derived(), 1);
  unrelated.set(2);
  assert.equal(derived(), 1);
  assert.equal(calls, 2);
});

test('a parent catching a failed computed read is invalidated when its dependency recovers', () => {
  const source = signal(0);
  const child = computed(() => {
    if (source() === 0) throw new Error('not ready');
    return source();
  });
  const parent = computed(() => {
    try {
      return child();
    } catch {
      return -1;
    }
  });
  assert.equal(parent(), -1);
  source.set(2);
  assert.equal(parent(), 2);
});

test('writes to directly read dependencies diagnose computed and signal sources before mutation', () => {
  const source = signal(1);
  const invalid = computed(function writeBack() {
    const value = source();
    source.set(value + 1);
    return value;
  });
  assert.throws(invalid, /computed.*writeBack.*signal/i);
  assert.equal(source(), 1);
  const valid = computed(() => source() + 1);
  assert.equal(valid(), 2);
});

test('writes to transitive dependencies during computed calculation are diagnosed', () => {
  const source = signal(1);
  const child = computed(() => source() * 2);
  child(); // Also cover a cached child, rather than only an active nested calculation.
  const invalid = computed(function indirectWrite() {
    const value = child();
    source.update((n) => n + 1);
    return value;
  });
  assert.throws(invalid, /computed.*indirectWrite.*signal/i);
  assert.equal(source(), 1);
});

test('dependencies first read after a write still produce a sourced diagnostic', () => {
  const source = signal(1);
  const invalid = computed(function lateDependency() {
    source.set(2);
    return source();
  });
  assert.throws(invalid, /computed.*lateDependency.*signal/i);
});

test('direct and indirect computed cycles report their computation sources and recover tracking', () => {
  let direct: ReadSignal<number>;
  direct = computed(function directCycle(): number {
    return direct();
  });
  assert.throws(direct, /cycl.*computed.*directCycle/i);
  let first: ReadSignal<number>;
  let second: ReadSignal<number>;
  first = computed(function firstCycle(): number {
    return second();
  });
  second = computed(function secondCycle(): number {
    return first();
  });
  assert.throws(first, /cycl.*firstCycle.*secondCycle/i);
  const source = signal(1);
  assert.equal(computed(() => source() + 1)(), 2);
});

test('snapshots reject non-plain data without replacing the previous signal value', () => {
  const source = signal<unknown>({ score: 1 });
  const before = source();
  assert.throws(() => source.set(new Map()), /plain objects and arrays/);
  assert.strictEqual(source(), before);
  assert.throws(() => computed(() => new Date())(), /plain objects and arrays/);
});

test('effects batch notifications, read current derived values and clean up before rerun', async () => {
  const scope = new Scope(),
    a = signal(1),
    b = signal(2);
  const total = computed(() => a() + b());
  const calls: string[] = [];
  const stop = effect((onCleanup) => {
    const value = total();
    calls.push(`run:${value}`);
    onCleanup(() => calls.push(`clean:${value}`));
  }, scope);
  assert.deepEqual(calls, []);
  await flushed();
  batch(() => {
    a.set(3);
    batch(() => b.set(4));
    assert.equal(total(), 7);
    assert.deepEqual(calls, ['run:3']);
  });
  await flushed();
  assert.deepEqual(calls, ['run:3', 'clean:3', 'run:7']);
  a.set(3);
  await flushed();
  assert.equal(calls.length, 3);
  stop();
  stop();
  scope.dispose();
  a.set(5);
  await flushed();
  assert.deepEqual(calls, ['run:3', 'clean:3', 'run:7', 'clean:7']);
});

test('unchanged computed output skips effects while a changed branch rebuilds dependencies', async () => {
  const scope = new Scope(),
    source = signal(2),
    other = signal(10),
    branch = signal(true);
  const parity = computed(() => source() % 2);
  const seen: number[] = [];
  effect(() => seen.push(branch() ? parity() : other()), scope);
  await flushed();
  source.set(4);
  await flushed();
  assert.deepEqual(seen, [0]);
  branch.set(false);
  await flushed();
  source.set(5);
  await flushed();
  other.set(11);
  await flushed();
  assert.deepEqual(seen, [0, 10, 11]);
  scope.dispose();
});

test('scope disposal before a scheduled effect prevents execution', async () => {
  const scope = new Scope();
  let count = 0;
  effect(() => {
    count++;
  }, scope);
  scope.dispose();
  effect(() => {
    count++;
  }, scope);
  await flushed();
  assert.equal(count, 0);
});

test('batch errors preserve committed writes and still notify once', async () => {
  const scope = new Scope(),
    value = signal(0),
    seen: number[] = [];
  effect(() => seen.push(value()), scope);
  await flushed();
  const failure = new Error('business failure');
  assert.throws(
    () =>
      batch(() => {
        value.set(1);
        throw failure;
      }),
    (error) => error === failure,
  );
  assert.equal(value(), 1);
  await flushed();
  assert.deepEqual(seen, [0, 1]);
  scope.dispose();
});

test('effect failure reports source and permits dependency recovery without blocking other effects', async () => {
  const scope = new Scope(),
    source = signal(0),
    errors: unknown[] = [],
    seen: number[] = [];
  effect(
    function loadView() {
      if (!source()) throw new Error('not ready');
      seen.push(source());
    },
    scope,
    { onError: (error) => errors.push(error) },
  );
  effect(() => {
    source();
    seen.push(9);
  }, scope);
  await flushed();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /effect.*loadView/);
  source.set(1);
  await flushed();
  assert.deepEqual(seen, [9, 1, 9]);
  scope.dispose();
});

test('feedback updates run in later batches and an unbounded cycle is stopped with a diagnostic', async () => {
  const scope = new Scope(),
    source = signal(0),
    errors: unknown[] = [];
  let depth = 0,
    maxDepth = 0;
  effect(
    function feedbackLoop() {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      source.set(source() + 1);
      depth--;
    },
    scope,
    { onError: (error) => errors.push(error) },
  );
  await flushed();
  assert.equal(maxDepth, 1);
  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as Error).cause), /feedbackLoop.*cycle/i);
  const value = source();
  source.set(200);
  await flushed();
  assert.equal(source(), 200);
  assert.ok(value > 0);
  assert.equal(errors.length, 1);
  scope.dispose();
});

test('nextTick waits for consequent reactive batches, including cancellation, and resolves while idle', async () => {
  const { nextTick } = await import('@xiaobaibaifqy/jingchuanchu-app/application');
  const scope = new Scope(),
    count = signal(0),
    seen: number[] = [];
  effect(() => {
    const value = count();
    seen.push(value);
    if (value < 3) count.set(value + 1);
  }, scope);
  await nextTick();
  assert.deepEqual(seen, [0, 1, 2, 3]);
  count.set(4);
  scope.dispose();
  await nextTick();
  assert.deepEqual(seen, [0, 1, 2, 3]);
  let settled = false;
  const idle = nextTick().then(() => {
    settled = true;
  });
  assert.equal(settled, false);
  await idle;
  assert.equal(settled, true);
});
