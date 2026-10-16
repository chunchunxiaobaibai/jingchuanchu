import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EventBus, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

test('fixed steps, ordering, pause and large-frame clamp', () => {
  const engine = new Engine({ tickRate: 10, maxSteps: 3 });
  const calls: string[] = [];
  engine.addSystem({ id: 'late', order: 2, update: () => calls.push('late') });
  engine.addSystem({
    id: 'early',
    order: 1,
    update: ({ world }) => {
      calls.push('early');
      world.defer(() => calls.push('flush'));
    },
  });
  engine.addSystem({ id: 'render', phase: 'render', update: () => calls.push('render') });
  engine.start();
  engine.advance(0.1);
  assert.deepEqual(calls, ['early', 'late', 'flush', 'render']);
  engine.pause();
  engine.advance(1);
  assert.equal(calls.length, 4);
  engine.resume();
  calls.length = 0;
  engine.advance(100);
  assert.equal(calls.filter((c) => c === 'early').length, 3);
  engine.dispose();
  assert.throws(() => engine.advance(1));
});

test('module dependencies, reverse cleanup, failed setup rollback', () => {
  const engine = new Engine();
  const order: string[] = [];
  engine.install([
    {
      id: 'b',
      dependencies: ['a'],
      setup: (_, scope) => {
        order.push('b');
        scope.own(() => order.push('-b'));
      },
    },
    {
      id: 'a',
      setup: (_, scope) => {
        order.push('a');
        scope.own(() => order.push('-a'));
      },
    },
  ]);
  engine.dispose();
  assert.deepEqual(order, ['a', 'b', '-b', '-a']);
  const failed = new Engine();
  let cleaned = false;
  assert.throws(() =>
    failed.install([
      {
        id: 'bad',
        setup: (_, scope) => {
          scope.own(() => {
            cleaned = true;
          });
          throw new Error('oops');
        },
      },
    ]),
  );
  assert.equal(cleaned, true);
  assert.throws(() => new Engine().install([{ id: 'a', dependencies: ['a'], setup() {} }]));
  assert.throws(() => new Engine().install([{ id: 'a', dependencies: ['missing'], setup() {} }]));
});

test('typed events unsubscribe with scope; all cleanup runs on failure', () => {
  const events = new EventBus<{ score: number }>();
  const scope = new Scope();
  let count = 0;
  events.on(
    'score',
    (value) => {
      count += value;
    },
    scope,
  );
  events.emit('score', 3);
  scope.dispose();
  events.emit('score', 3);
  assert.equal(count, 3);
  const broken = new Scope();
  let cleaned = false;
  broken.own(() => {
    cleaned = true;
  });
  broken.own(() => {
    throw new Error('cleanup');
  });
  assert.throws(() => broken.dispose());
  assert.equal(cleaned, true);
  broken.dispose();
});

test('disposal from inside a system stops the current frame without accessing disposed state', () => {
  const engine = new Engine();
  let laterRan = false;
  engine.addSystem({ id: 'dispose', update: () => engine.dispose() });
  engine.addSystem({
    id: 'later',
    update: () => {
      laterRan = true;
    },
  });
  engine.start();
  assert.doesNotThrow(() => engine.advance(1));
  assert.equal(laterRan, false);
  assert.equal(engine.status, 'disposed');
});

test('an old event unsubscribe cannot remove a newer listener for the same event', () => {
  const events = new EventBus<{ score: number }>();
  let score = 0;
  const off = events.on('score', () => {});
  off();
  events.on('score', (value) => {
    score = value;
  });
  off();
  events.emit('score', 42);
  assert.equal(score, 42);
});

test('deferred disposal skips remaining commands and render systems', () => {
  const engine = new Engine();
  let laterRan = false;
  engine.addSystem({
    id: 'dispose',
    update: ({ world }) => {
      world.defer(() => engine.dispose());
      world.defer(() => {
        laterRan = true;
      });
    },
  });
  engine.addSystem({
    id: 'render',
    phase: 'render',
    update: () => {
      laterRan = true;
    },
  });
  engine.start();
  engine.advance(engine.step);
  assert.equal(laterRan, false);
});

test('event failures still notify other listeners and startup failures stop activated modules', () => {
  const engine = new Engine();
  let stopped = 0;
  let started = 0;
  const off = engine.events.on('started', () => {
    throw new Error('module activation failed');
  });
  engine.events.on('started', () => {
    started++;
  });
  engine.events.on('stopped', () => {
    stopped++;
  });
  assert.throws(() => engine.start());
  assert.equal(engine.status, 'stopped');
  assert.equal(started, 1);
  assert.equal(stopped, 1);
  off();
  engine.start();
  engine.pause();
  engine.events.on('resumed', () => {
    throw new Error('resume failed');
  });
  assert.throws(() => engine.resume());
  assert.equal(engine.status, 'stopped');
  assert.equal(stopped, 2);
  engine.dispose();
});

test('system constraints validate before activation; diagnostics are optional', () => {
  const engine = new Engine({ diagnostics: false });
  const calls: string[] = [];
  engine.addSystem({ id: 'first', after: ['last'], update: () => calls.push('first') });
  engine.addSystem({ id: 'last', update: () => calls.push('last') });
  engine.start();
  engine.advance(engine.step);
  assert.deepEqual(calls, ['last', 'first']);
  assert.equal(engine.timings.length, 0);
  assert.deepEqual(
    engine.getSystems().map((s) => s.id),
    ['last', 'first'],
  );
  engine.dispose();
  for (const systems of [
    [{ id: 'a', after: ['missing'], update() {} }],
    [
      { id: 'a', after: ['b'], update() {} },
      { id: 'b', after: ['a'], update() {} },
    ],
    [
      { id: 'a', after: ['b'], update() {} },
      { id: 'b', phase: 'render' as const, update() {} },
    ],
  ]) {
    const broken = new Engine();
    for (const system of systems) broken.addSystem(system);
    assert.throws(() => broken.start());
    assert.equal(broken.status, 'stopped');
    broken.dispose();
  }
});

test('deferred failure stops the engine and preserves the original cause', () => {
  const engine = new Engine();
  const cause = new Error('defer');
  let rendered = false;
  engine.addSystem({
    id: 'queue',
    update({ world }) {
      world.defer(() => {
        throw cause;
      });
    },
  });
  engine.addSystem({
    id: 'render',
    phase: 'render',
    update() {
      rendered = true;
    },
  });
  engine.start();
  assert.throws(
    () => engine.advance(engine.step),
    (error: unknown) => error instanceof Error && error.cause === cause,
  );
  assert.equal(engine.status, 'stopped');
  assert.equal(rendered, false);
  engine.dispose();
});

test('active traversal is stable across scoped system removal and registration', () => {
  const engine = new Engine({ diagnostics: false }),
    scope = new Scope(),
    calls: string[] = [];
  let changed = false;
  engine.addSystem({
    id: 'mutate',
    update() {
      calls.push('mutate');
      if (!changed) {
        changed = true;
        scope.dispose();
        engine.addSystem({
          id: 'new',
          update() {
            calls.push('new');
          },
        });
      }
    },
  });
  engine.addSystem(
    {
      id: 'removed',
      update() {
        calls.push('removed');
      },
    },
    scope,
  );
  engine.start();
  engine.advance(engine.step);
  assert.deepEqual(calls, ['mutate', 'removed']);
  calls.length = 0;
  engine.advance(engine.step);
  assert.deepEqual(calls, ['mutate', 'new']);
  engine.dispose();
  assert.deepEqual(engine.getSystems(), []);
});

test('engine disposal preserves event and scope failures while completing cleanup', () => {
  const engine = new Engine();
  const eventError = new Error('disposed event');
  const cleanupError = new Error('module cleanup');
  let cleaned = false;
  engine.world.create();
  engine.addSystem({ id: 'tick', update() {} });
  engine.events.on('disposed', () => {
    throw eventError;
  });
  engine.scope.own(() => {
    cleaned = true;
  });
  engine.scope.own(() => {
    throw cleanupError;
  });
  const failures: unknown[] = [];
  const collect = (error: unknown): void => {
    if (error instanceof AggregateError) error.errors.forEach(collect);
    else failures.push(error);
  };
  assert.throws(
    () => engine.dispose(),
    (error: unknown) => {
      collect(error);
      return true;
    },
  );
  assert.deepEqual(failures, [eventError, cleanupError]);
  assert.equal(cleaned, true);
  assert.equal(engine.status, 'disposed');
  assert.equal(engine.world.size, 0);
  assert.deepEqual(engine.getSystems(), []);
  assert.doesNotThrow(() => engine.dispose());
});
