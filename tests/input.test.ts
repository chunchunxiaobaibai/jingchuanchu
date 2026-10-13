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
