import type { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
export interface PointerHandlers {
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
}
export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly down: EventListener;
  private readonly up: EventListener;
  private readonly blur = (): void => this.clear();
  constructor(
    private readonly target: EventTarget,
    preventDefault: readonly string[] = [],
  ) {
    const prevent = new Set(preventDefault);
    this.down = (event) => {
      const keyboard = event as KeyboardEvent;
      if (
        typeof HTMLElement !== 'undefined' &&
        keyboard.target instanceof HTMLElement &&
        (keyboard.target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(keyboard.target.tagName))
      )
        return;
      this.keys.add(keyboard.code);
      if (prevent.has(keyboard.code)) keyboard.preventDefault();
    };
    this.up = (event) => {
      this.keys.delete((event as KeyboardEvent).code);
    };
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.blur);
  }
  isDown(code: string): boolean {
    return this.keys.has(code);
  }
  clear(): void {
    this.keys.clear();
  }
  dispose(): void {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
    this.clear();
  }
}

export function bindPointer(
  canvas: HTMLCanvasElement,
  handlers: PointerHandlers,
  scope: Scope,
): void {
  let activePointer: number | undefined;
  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0 || activePointer !== undefined) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    handlers.down(event);
  };
  const move = (event: PointerEvent): void => {
    if (activePointer === event.pointerId && canvas.hasPointerCapture(event.pointerId))
      handlers.move(event);
  };
  const up = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    activePointer = undefined;
    handlers.up(event);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  for (const [name, callback] of [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['lostpointercapture', up],
  ] as const) {
    canvas.addEventListener(name, callback);
    scope.own(() => canvas.removeEventListener(name, callback));
  }
  scope.own(() => {
    const pointer = activePointer;
    activePointer = undefined;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
  });
}
