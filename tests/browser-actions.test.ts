import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  createActions,
  createViewport,
  defineActions,
  ActionError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

function fixture() {
  const window = new Window(),
    document = window.document as unknown as Document;
  const host = document.createElement('div'),
    canvas = document.createElement('canvas'),
    input = document.createElement('input'),
    button = document.createElement('button'),
    outside = document.createElement('input');
  host.append(canvas, input, button);
  document.body.append(host, outside);
  const captures = new Set<number>();
  let taken = 0;
  canvas.setPointerCapture = (id) => {
    captures.add(id);
    taken++;
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  const scope = new Scope();
  const viewport = createViewport({
    canvas,
    width: 100,
    height: 50,
    scope,
    driver: {
      measure: () => ({ left: 10, top: 20, width: 200, height: 200, pixelRatio: 1 }),
      observe: () => () => {},
      apply() {},
    },
  });
  const definition = defineActions({
    moveX: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'], preventDefault: true },
    fire: { kind: 'button', keys: ['Space'], pointer: 'primary', preventDefault: true },
  });
  const actions = createActions({ definition, canvas, viewport, scope });
  const key = (
    target: Element,
    type: string,
    code: string,
    extra: Pick<KeyboardEventInit, 'repeat' | 'isComposing' | 'keyCode' | 'ctrlKey'> = {},
  ) => {
    const event = new window.KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      code,
      ...extra,
    });
    target.dispatchEvent(event as unknown as Event);
    return event;
  };
  const pointer = (type: string, x = 110, y = 120, id = 1, primary = true) => {
    const event = new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: id,
      isPrimary: primary,
      button: 0,
    });
    canvas.dispatchEvent(event as unknown as Event);
    return event;
  };
  return {
    window,
    document,
    host,
    canvas,
    input,
    button,
    outside,
    scope,
    viewport,
    definition,
    actions,
    captures,
    key,
    pointer,
    taken: () => taken,
  };
}
const neutral = { down: false, pressed: false, released: false };

test('focused host keyboard and HUD virtual sources share snapshots without intercepting forms/shortcuts/IME', () => {
  const f = fixture();
  try {
    f.canvas.focus();
    assert.equal(f.key(f.canvas, 'keydown', 'KeyD').defaultPrevented, true);
    assert.equal(f.actions.read().axes.moveX, 1);
    f.key(f.canvas, 'keydown', 'Space');
    f.key(f.canvas, 'keyup', 'Space');
    assert.deepEqual(f.actions.read().buttons.fire, { down: false, pressed: true, released: true });
    assert.deepEqual(f.actions.read().buttons.fire, neutral);
    f.input.focus();
    assert.equal(f.actions.read().axes.moveX, 0);
    assert.equal(f.key(f.input, 'keydown', 'Space').defaultPrevented, false);
    f.actions.setVirtual('fire', true);
    assert.deepEqual(f.actions.read().buttons.fire, neutral);
    f.canvas.focus();
    f.key(f.canvas, 'keydown', 'Space', { repeat: true });
    assert.deepEqual(f.actions.read().buttons.fire, neutral);
    f.key(f.canvas, 'keydown', 'KeyD');
    f.canvas.dispatchEvent(
      new f.window.Event('compositionstart', { bubbles: true }) as unknown as Event,
    );
    assert.equal(f.actions.read().axes.moveX, 0);
    assert.equal(f.key(f.canvas, 'keydown', 'Space').defaultPrevented, false);
    f.canvas.dispatchEvent(
      new f.window.Event('compositionend', { bubbles: true }) as unknown as Event,
    );
    f.key(f.canvas, 'keydown', 'Space', { isComposing: true });
    f.key(f.canvas, 'keydown', 'Space', { keyCode: 229 });
    assert.deepEqual(f.actions.read().buttons.fire, neutral);
    assert.equal(f.key(f.canvas, 'keydown', 'KeyD', { ctrlKey: true }).defaultPrevented, false);
    f.button.focus();
    assert.equal(f.key(f.button, 'keydown', 'Space').defaultPrevented, false);
    f.actions.setVirtual('fire', true, 'hud');
    assert.equal(f.actions.read().buttons.fire.down, true);
    f.actions.setVirtual('fire', false, 'hud');
    assert.equal(f.actions.read().buttons.fire.released, true);
    f.outside.focus();
    assert.equal(f.key(f.outside, 'keydown', 'KeyD').defaultPrevented, false);
    assert.equal(f.actions.read().axes.moveX, 0);
  } finally {
    f.scope.dispose();
  }
});

test('primary pointer checks contain bounds before capture, maps drag and clears cancellation instead of synthesizing release', () => {
  const f = fixture();
  try {
    assert.equal(f.pointer('pointerdown', 110, 30).defaultPrevented, false);
    f.pointer('pointerdown', 110, 120, 2, false);
    assert.equal(f.taken(), 0);
    f.input.focus();
    assert.equal(f.pointer('pointerdown').defaultPrevented, true);
    assert.equal(f.document.activeElement, f.canvas);
    assert.deepEqual([...f.captures], [1]);
    let state = f.actions.read();
    assert.deepEqual(state.pointer.point, { x: 50, y: 25, inside: true });
    assert.equal(state.buttons.fire.pressed, true);
    f.pointer('pointerdown', 110, 120, 2);
    assert.equal(f.taken(), 1);
    f.pointer('pointermove', 250, 120);
    assert.equal(f.actions.read().pointer.down, true);
    f.pointer('pointerup', 250, 120);
    state = f.actions.read();
    assert.deepEqual(state.pointer.point, { x: 100, y: 25, inside: false });
    assert.equal(state.buttons.fire.released, true);
    assert.equal(f.captures.size, 0);
    for (const reason of ['pointercancel', 'lostpointercapture']) {
      f.pointer('pointerdown');
      f.actions.read();
      if (reason === 'lostpointercapture') f.captures.clear();
      f.pointer(reason);
      f.pointer('pointerup');
      assert.deepEqual(f.actions.read().buttons.fire, neutral);
      assert.equal(f.captures.size, 0);
    }
  } finally {
    f.scope.dispose();
  }
});

test('pause, blur, hidden document, editable focus and owner exit release capture and remove owned listeners/styles', () => {
  const f = fixture();
  let visibility = 'visible';
  Object.defineProperty(f.document, 'visibilityState', { get: () => visibility });
  const reset = () => {
    assert.equal(f.captures.size, 0);
    assert.deepEqual(f.actions.read().buttons.fire, neutral);
  };
  f.pointer('pointerdown');
  f.actions.setActive(false);
  reset();
  f.actions.setVirtual('fire', true);
  f.pointer('pointerdown');
  reset();
  f.actions.setActive(true);
  f.pointer('pointerdown');
  f.window.dispatchEvent(new f.window.Event('blur'));
  reset();
  f.window.dispatchEvent(new f.window.Event('focus'));
  f.pointer('pointerdown');
  visibility = 'hidden';
  f.document.dispatchEvent(new f.window.Event('visibilitychange') as unknown as Event);
  reset();
  visibility = 'visible';
  f.pointer('pointerdown');
  f.input.focus();
  reset();
  f.pointer('pointerdown');
  assert.equal(f.canvas.style.getPropertyValue('touch-action'), 'none');
  f.scope.dispose();
  f.actions.dispose();
  assert.equal(f.actions.disposed, true);
  assert.equal(f.captures.size, 0);
  assert.equal(f.canvas.hasAttribute('tabindex'), false);
  assert.equal(f.canvas.style.getPropertyValue('touch-action'), '');
  const taken = f.taken();
  f.pointer('pointerdown');
  f.key(f.canvas, 'keydown', 'Space');
  assert.equal(f.taken(), taken);
  assert.throws(() => f.actions.read(), ActionError);
  assert.throws(() => f.actions.setVirtual('fire', true), ActionError);
});

test('duplicate ownership and closed scopes reject cleanly; manual disposal permits reuse and preserves external changes', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        createActions({
          definition: f.definition,
          canvas: f.canvas,
          viewport: f.viewport,
          scope: new Scope(),
        }),
      ActionError,
    );
    f.canvas.setAttribute('tabindex', '5');
    f.canvas.style.setProperty('touch-action', 'pan-y', 'important');
    f.actions.dispose();
    assert.equal(f.canvas.getAttribute('tabindex'), '5');
    assert.equal(f.canvas.style.getPropertyValue('touch-action'), 'pan-y');
    const closed = new Scope();
    closed.dispose();
    assert.throws(
      () =>
        createActions({
          definition: f.definition,
          canvas: f.canvas,
          viewport: f.viewport,
          scope: closed,
        }),
      ActionError,
    );
    const scope = new Scope();
    const next = createActions({
      definition: f.definition,
      canvas: f.canvas,
      viewport: f.viewport,
      scope,
    });
    scope.dispose();
    assert.equal(next.disposed, true);
    assert.equal(f.canvas.getAttribute('tabindex'), '5');
    assert.equal(f.canvas.style.getPropertyValue('touch-action'), 'pan-y');
    assert.equal(f.canvas.style.getPropertyPriority('touch-action'), 'important');
  } finally {
    f.scope.dispose();
  }
});
