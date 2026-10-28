import assert from 'node:assert/strict';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { computed, effect, nextTick, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';

assert.ok(globalThis.gc, 'Run this fixture with --expose-gc');
const source = signal(1);
function temporaryScope(derived: boolean) {
  const captured = { value: 1 };
  const weak = new WeakRef(captured);
  const scope = new Scope();
  const read = derived
    ? computed(() => captured.value + source())
    : () => captured.value + source();
  effect(() => {
    read();
  }, scope);
  return { weak, scope };
}
function temporaryComputed() {
  const captured = { value: 1 };
  computed(() => captured.value + source())();
  return new WeakRef(captured);
}
const derived = Array.from({ length: 20 }, () => temporaryScope(true));
const direct = Array.from({ length: 20 }, () => temporaryScope(false));
const unobserved = Array.from({ length: 20 }, temporaryComputed);
const liveScope = new Scope(),
  seen: number[] = [];
// The effect's dependency graph must retain this computed even without a user-held reference.
effect(() => {
  seen.push(computed(() => source() * 2)());
}, liveScope);
await nextTick();
for (const item of [...derived, ...direct]) item.scope.dispose();
for (let i = 0; i < 8; i++) {
  await new Promise<void>((done) => setImmediate(done));
  globalThis.gc();
}
assert.equal(direct.filter(({ weak }) => weak.deref()).length, 0, 'control objects were collected');
assert.equal(
  derived.filter(({ weak }) => weak.deref()).length,
  0,
  'disposed computed closures were collected',
);
assert.equal(
  unobserved.filter((weak) => weak.deref()).length,
  0,
  'unobserved computed closures were collected',
);
source.set(2);
await nextTick();
assert.deepEqual(seen, [2, 4], 'live dependencies survive GC and still invalidate');
liveScope.dispose();
