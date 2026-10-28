import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine, Scope, SystemError } from '@xiaobaibaifqy/jingchuanchu-core';
import { createGameClock, GameClockError } from '@xiaobaibaifqy/jingchuanchu-app/application';

test('clock single/repeat tasks follow elapsed logical steps, preserve phase and pause without wall time', () => {
  const scope = new Scope(),
    clock = createGameClock({ scope });
  const calls: string[] = [];
  const once = clock.after(0.3, () => calls.push('once'));
  const repeat = clock.every(0.2, () => calls.push('repeat'));
  clock.advance(0.1);
  assert.deepEqual(calls, []);
  clock.advance(0.1);
  assert.deepEqual(calls, ['repeat']);
  clock.setActive(false);
  clock.advance(1000);
  clock.setActive(true);
  clock.advance(0.1);
  assert.equal(once.status, 'completed');
  assert.deepEqual(calls, ['repeat', 'once']);
  clock.advance(0.1);
  assert.deepEqual(calls, ['repeat', 'once', 'repeat']);
  clock.advance(0.65);
  assert.equal(calls.length, 4);
  clock.advance(0.14);
  assert.equal(calls.length, 4);
  clock.advance(0.01);
  assert.equal(calls.length, 5);
  repeat.cancel();
  repeat.cancel();
  once.cancel();
  clock.advance(1);
  assert.equal(calls.length, 5);
  assert.equal(repeat.status, 'cancelled');
  assert.equal(once.status, 'completed');
  scope.dispose();
  assert.equal(clock.disposed, true);
});

test('snapshot ordering defers new tasks and skips cancellation/owner disposal during callbacks', () => {
  const scope = new Scope(),
    clock = createGameClock({ scope });
  const calls: string[] = [];
  clock.after(1, () => {
    calls.push('first');
    later.cancel();
    clock.after(0.1, () => calls.push('new'));
  });
  const later = clock.after(1, () => calls.push('cancelled'));
  const self = clock.every(1, () => {
    calls.push('self');
    self.cancel();
  });
  clock.advance(1);
  assert.deepEqual(calls, ['first', 'self']);
  clock.advance(0);
  assert.deepEqual(calls, ['first', 'self']);
  clock.advance(0.1);
  assert.deepEqual(calls, ['first', 'self', 'new']);
  clock.after(1, () => scope.dispose());
  const pending = clock.after(1, () => calls.push('disposed'));
  clock.advance(1);
  assert.equal(pending.status, 'cancelled');
  assert.deepEqual(calls, ['first', 'self', 'new']);
  clock.dispose();
  assert.throws(() => clock.after(1, () => {}), GameClockError);
  assert.throws(() => clock.advance(1), GameClockError);
});

test('clock is driven by real Engine fixed steps and errors retain task source in SystemError', () => {
  const engine = new Engine({ tickRate: 10, maxSteps: 3 });
  const clock = createGameClock({ scope: engine.scope, source: 'play/countdown' });
  const calls: string[] = [];
  engine.addSystem({ id: 'game-clock', update: ({ delta }) => clock.advance(delta) });
  clock.every(0.1, () => calls.push('tick'));
  engine.start();
  engine.advance(0.1);
  engine.pause();
  engine.advance(500);
  assert.equal(calls.length, 1);
  engine.resume();
  engine.advance(500);
  assert.equal(calls.length, 4);
  const cause = new Error('timer failed');
  const broken = clock.every(0.1, () => {
    throw cause;
  });
  assert.throws(
    () => engine.advance(0.1),
    (error: unknown) => {
      assert.ok(error instanceof SystemError);
      assert.equal(error.systemId, 'game-clock');
      assert.equal(error.phase, 'fixed');
      assert.ok(error.cause instanceof GameClockError);
      assert.equal(error.cause.source, 'play/countdown');
      assert.equal(error.cause.operation, 'every.callback');
      assert.equal(error.cause.taskId, 2);
      assert.equal(error.cause.cause, cause);
      return true;
    },
  );
  assert.equal(engine.status, 'stopped');
  assert.equal(broken.status, 'failed');
  engine.start();
  engine.advance(0.1);
  assert.equal(calls.length, 6);
  engine.dispose();
  assert.equal(clock.disposed, true);
});

test('invalid timing, closed scopes and reentrant advances fail without corrupting remaining tasks', () => {
  const scope = new Scope(),
    clock = createGameClock({ scope });
  for (const invalid of [0, -1, NaN, Infinity])
    assert.throws(() => clock.after(invalid, () => {}), GameClockError);
  for (const invalid of [-1, NaN, Infinity])
    assert.throws(() => clock.advance(invalid), GameClockError);
  const task = clock.after(1, () => clock.advance(0.1));
  const next = clock.after(1, () => {});
  assert.throws(
    () => clock.advance(1),
    (error: unknown) =>
      error instanceof GameClockError &&
      error.cause instanceof GameClockError &&
      error.cause.operation === 'advance',
  );
  assert.equal(task.status, 'failed');
  assert.equal(next.status, 'pending');
  clock.advance(0.1);
  assert.equal(next.status, 'completed');
  scope.dispose();
  assert.throws(() => createGameClock({ scope }), GameClockError);
});

test('Promise-returning timer callback is rejected with source and no unhandled rejection', async () => {
  const scope = new Scope(),
    clock = createGameClock({ scope, source: 'async-test' });
  const task = clock.after(1, () => Promise.reject(new Error('async timer')));
  assert.throws(
    () => clock.advance(1),
    (error: unknown) =>
      error instanceof GameClockError &&
      error.source === 'async-test' &&
      error.operation === 'after.callback',
  );
  await Promise.resolve();
  assert.equal(task.status, 'failed');
  scope.dispose();
});

test('numeric/object tweens use named easing, copied endpoints, readonly updates and one exact completion', () => {
  const scope = new Scope(),
    clock = createGameClock({ scope });
  const eased: number[] = [];
  for (const [easing, expected] of [
    ['linear', 0.25],
    ['ease-in', 0.0625],
    ['ease-out', 0.4375],
    ['ease-in-out', 0.125],
  ] as const) {
    clock.tween({
      from: 0,
      to: 1,
      duration: 1,
      easing,
      onUpdate: (value) => {
        eased.push(value);
      },
    });
    clock.advance(0.25);
    assert.equal(eased.at(-1), expected);
  }
  clock.setActive(false);
  const count = eased.length;
  clock.advance(100);
  assert.equal(eased.length, count);
  clock.setActive(true);
  const from = { x: 0, alpha: 1 },
    to = { x: 10, alpha: 0 };
  const values: Readonly<{ x: number; alpha: number }>[] = [];
  let completed = 0;
  const handle = clock.tween({
    from,
    to,
    duration: 1,
    onUpdate(value) {
      values.push(value);
    },
    onComplete() {
      completed++;
    },
  });
  from.x = 100;
  to.x = 200;
  assert.equal(values.length, 0);
  clock.advance(0.5);
  assert.deepEqual(values, [{ x: 5, alpha: 0.5 }]);
  assert.equal(Reflect.set(values[0]!, 'x', 99), false);
  clock.advance(0.5);
  clock.advance(1);
  assert.deepEqual(values, [
    { x: 5, alpha: 0.5 },
    { x: 10, alpha: 0 },
  ]);
  assert.equal(handle.status, 'completed');
  assert.equal(completed, 1);
  handle.cancel();
  assert.equal(handle.status, 'completed');
  scope.dispose();
});

test('cross-registered timers/tweens wait until the next step and cancellation suppresses completion', () => {
  const scope = new Scope(),
    clock = createGameClock({ scope });
  const calls: string[] = [];
  clock.after(0.1, () => {
    clock.tween({
      from: 0,
      to: 1,
      duration: 0.1,
      onUpdate: () => {
        calls.push('from-timer');
      },
    });
  });
  clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => {
      calls.push('first');
      later.cancel();
      clock.after(0.1, () => {
        calls.push('from-tween');
      });
      clock.tween({
        from: 0,
        to: 1,
        duration: 0.1,
        onUpdate: () => {
          calls.push('new');
        },
      });
    },
  });
  const later = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => {
      calls.push('cancelled');
    },
  });
  const self = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => self.cancel(),
    onComplete: () => {
      calls.push('wrong-complete');
    },
  });
  clock.advance(0.1);
  assert.deepEqual(calls, ['first']);
  assert.equal(self.status, 'cancelled');
  clock.advance(0.1);
  assert.deepEqual(calls, ['first', 'from-tween', 'from-timer', 'new']);
  clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => scope.dispose(),
    onComplete: () => {
      calls.push('disposed-complete');
    },
  });
  const pending = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => {
      calls.push('disposed');
    },
  });
  clock.advance(0.1);
  assert.equal(pending.status, 'cancelled');
  assert.deepEqual(calls, ['first', 'from-tween', 'from-timer', 'new']);
});

test('tween validation and update/complete errors retain source and stop Engine dispatch', async () => {
  const { TweenError } = await import('@xiaobaibaifqy/jingchuanchu-app/application');
  const engine = new Engine({ tickRate: 10 });
  const clock = createGameClock({ scope: engine.scope, source: 'play/feedback' });
  for (const duration of [0, -1, NaN, Infinity])
    assert.throws(() => clock.tween({ from: 0, to: 1, duration, onUpdate() {} }), TweenError);
  assert.throws(
    () => clock.tween({ from: 0, to: Infinity, duration: 1, onUpdate() {} }),
    TweenError,
  );
  // JS callers also receive runtime shape diagnostics.
  assert.throws(
    () => clock.tween({ from: { x: 0 }, to: { y: 1 }, duration: 1, onUpdate() {} } as never),
    TweenError,
  );
  const original = new Error('failed update');
  const broken = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate() {
      throw original;
    },
    onComplete() {
      assert.fail('failed update completed');
    },
  });
  engine.addSystem({ id: 'feedback', update: ({ delta }) => clock.advance(delta) });
  engine.start();
  assert.throws(
    () => engine.advance(0.1),
    (error: unknown) => {
      assert.ok(error instanceof SystemError);
      assert.ok(error.cause instanceof TweenError);
      assert.equal(error.cause.source, 'play/feedback');
      assert.equal(error.cause.operation, 'update');
      assert.equal(error.cause.cause, original);
      return true;
    },
  );
  assert.equal(broken.status, 'failed');
  assert.equal(engine.status, 'stopped');
  const complete = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate() {},
    onComplete() {
      throw new Error('completion');
    },
  });
  assert.throws(
    () => clock.advance(0.1),
    (error: unknown) => error instanceof TweenError && error.operation === 'complete',
  );
  assert.equal(complete.status, 'failed');
  const asyncTask = clock.tween({
    from: 0,
    to: 1,
    duration: 0.1,
    onUpdate: () => Promise.reject(new Error('async')),
  });
  assert.throws(() => clock.advance(0.1), TweenError);
  await Promise.resolve();
  assert.equal(asyncTask.status, 'failed');
  engine.dispose();
  assert.throws(() => clock.tween({ from: 0, to: 1, duration: 1, onUpdate() {} }), TweenError);
});
