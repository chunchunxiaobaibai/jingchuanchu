import assert from 'node:assert/strict';
import test from 'node:test';
import { defineActions, ActionError } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ActionSampler } from '../packages/app/runtime/input-actions.js';

const definitions = () =>
  defineActions({
    moveX: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD', 'ArrowRight'] },
    fire: { kind: 'button', keys: ['Space'], pointer: 'primary' },
  });

test('fixed-step sampling merges sources and consumes button edges once', () => {
  const actions = new ActionSampler(definitions());
  actions.setKey('KeyD', true);
  actions.setKey('ArrowRight', true);
  actions.setVirtual('moveX', 0.5, 'stick');
  actions.setKey('Space', true);
  const first = actions.read();
  assert.equal(first.axes.moveX, 1);
  assert.deepEqual(first.buttons.fire, { down: true, pressed: true, released: false });
  actions.setVirtual('fire', true, 'hud');
  actions.setKey('Space', true);
  actions.setKey('Space', false);
  actions.setKey('KeyA', true);
  assert.deepEqual(actions.read().buttons.fire, { down: true, pressed: false, released: false });
  assert.equal(actions.read().axes.moveX, 0.5);
  actions.setVirtual('fire', false, 'hud');
  assert.deepEqual(actions.read().buttons.fire, { down: false, pressed: false, released: true });
  assert.equal(first.buttons.fire.down, true);
  assert.equal(Reflect.set(first.buttons.fire, 'down', false), false);
});

test('short taps preserve both edges and primary drags may finish outside', () => {
  const actions = new ActionSampler(definitions());
  actions.setKey('Space', true);
  actions.setKey('Space', false);
  assert.deepEqual(actions.read().buttons.fire, { down: false, pressed: true, released: true });
  assert.deepEqual(actions.read().buttons.fire, { down: false, pressed: false, released: false });
  actions.setPointer({ x: 0, y: 0, inside: false }, true);
  assert.equal(actions.read().pointer.down, false);
  actions.setPointer({ x: 20, y: 30, inside: true }, true);
  const pressed = actions.read();
  assert.equal(pressed.pointer.pressed, true);
  assert.equal(pressed.buttons.fire.pressed, true);
  actions.setPointer({ x: 100, y: 30, inside: false }, true);
  assert.equal(actions.read().pointer.down, true);
  actions.setPointer({ x: 100, y: 30, inside: false }, false);
  const released = actions.read();
  assert.equal(released.pointer.released, true);
  assert.equal(released.buttons.fire.released, true);
  assert.deepEqual(released.pointer.point, { x: 100, y: 30, inside: false });
  assert.ok(Object.isFrozen(released.pointer.point));
});

test('pause/clear erase held state and edges, inactive input is ignored, samplers are isolated', () => {
  const a = new ActionSampler(definitions()),
    b = new ActionSampler(definitions());
  a.setKey('Space', true);
  a.setVirtual('moveX', 1);
  a.setPointer({ x: 1, y: 1, inside: true }, true);
  assert.equal(b.read().buttons.fire.down, false);
  a.setActive(false);
  a.setKey('Space', true);
  a.setVirtual('fire', true);
  a.setPointer({ x: 1, y: 1, inside: true }, true);
  a.setActive(true);
  const resumed = a.read();
  assert.equal(resumed.axes.moveX, 0);
  assert.deepEqual(resumed.buttons.fire, { down: false, pressed: false, released: false });
  assert.deepEqual(resumed.pointer, { point: null, down: false, pressed: false, released: false });
  a.setKey('Space', true);
  a.clear();
  assert.equal(a.read().buttons.fire.pressed, false);
  a.dispose();
  a.dispose();
  assert.throws(() => a.read(), ActionError);
});

test('definitions copy mappings and reject invalid definitions/virtual values with action context', () => {
  const keys = ['Space'];
  const definition = defineActions({ fire: { kind: 'button', keys } });
  keys[0] = 'Enter';
  assert.deepEqual(definition.entries.fire.keys, ['Space']);
  assert.ok(Object.isFrozen(definition.entries.fire.keys));
  assert.throws(
    () => defineActions({ move: { kind: 'axis', negative: ['KeyA'], positive: ['KeyA'] } }),
    (error: unknown) =>
      error instanceof ActionError && error.source === 'move' && error.operation === 'define',
  );
  const actions = new ActionSampler(definitions());
  assert.throws(() => actions.setVirtual('moveX', Infinity), ActionError);
  assert.throws(() => actions.setVirtual('moveX', 2), ActionError);
  assert.throws(() => actions.setVirtual('fire', true, ''), ActionError);
});

test('fixed-shape snapshots stay deeply immutable and retain special action names', () => {
  const definition = defineActions({
    ['__proto__']: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] },
    constructor: { kind: 'button', keys: ['Space'] },
  });
  const sampler = new ActionSampler(definition);
  const point = { x: 12, y: 34, inside: true };
  sampler.setKey('KeyD', true);
  sampler.setKey('Space', true);
  sampler.setPointer(point, true);
  const first = sampler.read();
  point.x = 999;
  assert.equal(first.axes.__proto__, 1);
  assert.deepEqual(first.buttons.constructor, { down: true, pressed: true, released: false });
  assert.equal(Object.getPrototypeOf(first.axes), Object.prototype);
  assert.equal(Object.getPrototypeOf(first.buttons), Object.prototype);
  for (const value of [
    first,
    first.axes,
    first.buttons,
    first.buttons.constructor,
    first.pointer,
    first.pointer.point,
  ])
    assert.ok(Object.isFrozen(value));
  assert.equal(Reflect.set(first.axes, '__proto__', -1), false);
  assert.equal(Reflect.set(first.pointer.point!, 'x', -1), false);
  sampler.setPointer({ x: 56, y: 78, inside: false }, false);
  sampler.clear();
  const next = sampler.read();
  sampler.dispose();
  assert.equal(first.pointer.point!.x, 12);
  assert.equal(first.buttons.constructor.pressed, true);
  assert.equal(next.axes.__proto__, 0);
  assert.equal(next.buttons.constructor.down, false);
  assert.equal(next.pointer.point, null);
});
