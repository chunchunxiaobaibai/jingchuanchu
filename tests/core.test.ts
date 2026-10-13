import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EventBus, Scope } from '../packages/core/index.js';

test('fixed steps, ordering, pause and large-frame clamp', () => {
  const engine = new Engine({ tickRate: 10, maxSteps: 3 }); const calls: string[] = [];
  engine.addSystem({ id: 'late', order: 2, update: () => calls.push('late') });
  engine.addSystem({ id: 'early', order: 1, update: ({ world }) => { calls.push('early'); world.defer(() => calls.push('flush')); } });
  engine.addSystem({ id: 'render', phase: 'render', update: () => calls.push('render') });
  engine.start(); engine.advance(0.1); assert.deepEqual(calls, ['early', 'late', 'flush', 'render']);
  engine.pause(); engine.advance(1); assert.equal(calls.length, 4);
  engine.resume(); calls.length = 0; engine.advance(100); assert.equal(calls.filter(c => c === 'early').length, 3);
  engine.dispose(); assert.throws(() => engine.advance(1));
});

test('module dependencies, reverse cleanup, failed setup rollback', () => {
  const engine = new Engine(); const order: string[] = [];
  engine.install([
    { id: 'b', dependencies: ['a'], setup: (_, scope) => { order.push('b'); scope.own(() => order.push('-b')); } },
    { id: 'a', setup: (_, scope) => { order.push('a'); scope.own(() => order.push('-a')); } },
  ]);
  engine.dispose(); assert.deepEqual(order, ['a', 'b', '-b', '-a']);
  const failed = new Engine(); let cleaned = false;
  assert.throws(() => failed.install([{ id: 'bad', setup: (_, scope) => { scope.own(() => { cleaned = true; }); throw new Error('oops'); } }]));
  assert.equal(cleaned, true);
  assert.throws(() => new Engine().install([{ id: 'a', dependencies: ['a'], setup() {} }]));
  assert.throws(() => new Engine().install([{ id: 'a', dependencies: ['missing'], setup() {} }]));
});

test('typed events unsubscribe with scope; all cleanup runs on failure', () => {
  const events = new EventBus<{ score: number }>(); const scope = new Scope(); let count = 0;
  events.on('score', value => { count += value; }, scope); events.emit('score', 3); scope.dispose(); events.emit('score', 3);
  assert.equal(count, 3);
  const broken = new Scope(); let cleaned = false;
  broken.own(() => { cleaned = true; }); broken.own(() => { throw new Error('cleanup'); });
  assert.throws(() => broken.dispose()); assert.equal(cleaned, true); broken.dispose();
});
