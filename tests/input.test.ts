import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { bindPointer } from '@xiaobaibaifqy/jingchuanchu-input';

test('pointer input finishes once and releases active capture on module cleanup', () => {
  class Canvas extends EventTarget {
    captures = new Set<number>();
    setPointerCapture(id: number) {
      this.captures.add(id);
    }
    hasPointerCapture(id: number) {
      return this.captures.has(id);
    }
    releasePointerCapture(id: number) {
      this.captures.delete(id);
    }
  }
  const canvas = new Canvas();
  const scope = new Scope();
  let starts = 0;
  let finishes = 0;
  bindPointer(
    canvas as unknown as HTMLCanvasElement,
    {
      down() {
        starts++;
      },
      move() {},
      up() {
        finishes++;
      },
    },
    scope,
  );
  const pointer = (name: string, id: number) =>
    Object.assign(new Event(name), { pointerId: id, isPrimary: true, button: 0 });
  canvas.dispatchEvent(pointer('pointerdown', 1));
  canvas.dispatchEvent(pointer('pointerup', 1));
  canvas.dispatchEvent(pointer('lostpointercapture', 1));
  assert.equal(starts, 1);
  assert.equal(finishes, 1);
  canvas.dispatchEvent(pointer('pointerdown', 2));
  canvas.dispatchEvent(pointer('pointerdown', 3));
  assert.equal(starts, 2);
  scope.dispose();
  assert.equal(canvas.captures.size, 0);
  canvas.dispatchEvent(pointer('pointerdown', 4));
  assert.equal(starts, 2);
});

test('pointer cancellation and lost capture do not become normal releases', () => {
  class Canvas extends EventTarget {
    captures = new Set<number>();
    ownerDocument = { defaultView: new EventTarget() };
    setPointerCapture(id: number) {
      this.captures.add(id);
    }
    hasPointerCapture(id: number) {
      return this.captures.has(id);
    }
    releasePointerCapture(id: number) {
      this.captures.delete(id);
    }
  }
  const canvas = new Canvas(),
    scope = new Scope();
  let releases = 0;
  const reasons: string[] = [];
  bindPointer(
    canvas as unknown as HTMLCanvasElement,
    {
      down() {},
      move() {},
      up() {
        releases++;
      },
      cancel(_, reason) {
        reasons.push(reason);
      },
    },
    scope,
  );
  const pointer = (type: string, id: number) =>
    Object.assign(new Event(type), { pointerId: id, isPrimary: true, button: 0 });
  for (const [id, type] of [
    [1, 'pointercancel'],
    [2, 'lostpointercapture'],
  ] as const) {
    canvas.dispatchEvent(pointer('pointerdown', id));
    canvas.dispatchEvent(pointer(type, id));
    canvas.dispatchEvent(pointer('pointerup', id));
  }
  canvas.dispatchEvent(pointer('pointerdown', 3));
  canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
  canvas.dispatchEvent(pointer('pointerdown', 4));
  scope.dispose();
  assert.deepEqual(reasons, ['pointercancel', 'lostpointercapture', 'blur', 'dispose']);
  assert.equal(releases, 0);
  assert.equal(canvas.captures.size, 0);
});

test('repeated keys, editable focus and IME composition keep game input isolated', async () => {
  const { KeyboardInput } = await import('@xiaobaibaifqy/jingchuanchu-input');
  const original = globalThis.HTMLElement;
  class Editable extends EventTarget {
    tagName = 'INPUT';
    isContentEditable = false;
  }
  globalThis.HTMLElement = Editable as unknown as typeof HTMLElement;
  const target = new Editable();
  target.tagName = 'DIV';
  const keyboard = new KeyboardInput(target, ['KeyW']);
  const key = (composing = false) =>
    Object.assign(new Event('keydown', { cancelable: true }), {
      code: 'KeyW',
      isComposing: composing,
    });
  try {
    target.dispatchEvent(key());
    target.dispatchEvent(key());
    assert.equal(keyboard.isDown('KeyW'), true);
    target.tagName = 'INPUT';
    target.dispatchEvent(new Event('focusin'));
    const input = key();
    target.dispatchEvent(input);
    assert.equal(input.defaultPrevented, false);
    assert.equal(keyboard.isDown('KeyW'), false);
    target.tagName = 'DIV';
    target.dispatchEvent(new Event('compositionstart'));
    target.dispatchEvent(key());
    assert.equal(keyboard.isDown('KeyW'), false);
    target.dispatchEvent(new Event('compositionend'));
    target.dispatchEvent(key(true));
    target.dispatchEvent(Object.assign(key(), { keyCode: 229 }));
    assert.equal(keyboard.isDown('KeyW'), false);
    target.dispatchEvent(key());
    assert.equal(keyboard.isDown('KeyW'), true);
    target.dispatchEvent(new Event('blur'));
    assert.equal(keyboard.isDown('KeyW'), false);
  } finally {
    keyboard.dispose();
    globalThis.HTMLElement = original;
  }
});
