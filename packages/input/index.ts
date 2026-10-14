import type { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
export type PointerCancelReason = 'pointercancel' | 'lostpointercapture' | 'blur' | 'dispose';
export interface PointerHandlers {
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel?(event: Event, reason: PointerCancelReason): void;
}
export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly down: EventListener;
  private readonly up: EventListener;
  private readonly blur = (): void => {
    this.composing = false;
    this.clear();
  };
  private composing = false;
  private readonly focus = (): void => this.clear();
  private readonly compositionStart = (): void => {
    this.clear();
    this.composing = true;
  };
  private readonly compositionEnd = (): void => {
    this.composing = false;
  };
  constructor(
    private readonly target: EventTarget,
    preventDefault: readonly string[] = [],
  ) {
    const prevent = new Set(preventDefault);
    this.down = (event) => {
      const keyboard = event as KeyboardEvent;
      if (this.composing || keyboard.isComposing || keyboard.keyCode === 229) return;
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
    target.addEventListener('focusin', this.focus);
    target.addEventListener('compositionstart', this.compositionStart);
    target.addEventListener('compositionend', this.compositionEnd);
  }
  isDown(code: string): boolean {
    return this.keys.has(code);
  }
  clear(): void {
    this.composing = false;
    this.keys.clear();
  }
  dispose(): void {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
    this.target.removeEventListener('focusin', this.focus);
    this.target.removeEventListener('compositionstart', this.compositionStart);
    this.target.removeEventListener('compositionend', this.compositionEnd);
    this.composing = false;
    this.clear();
  }
}

export function bindPointer(
  canvas: HTMLCanvasElement,
  handlers: PointerHandlers,
  scope: Scope,
): void {
  let activePointer: number | undefined;
  let lastEvent: PointerEvent | undefined;
  const finish = (event: Event, reason?: PointerCancelReason): void => {
    if (activePointer === undefined) return;
    const pointer = activePointer;
    const last = lastEvent;
    activePointer = undefined;
    lastEvent = undefined;
    try {
      if (reason && handlers.cancel) handlers.cancel(event, reason);
      else if (reason !== 'dispose' && last) handlers.up(reason ? last : (event as PointerEvent));
    } finally {
      if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    }
  };
  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0 || activePointer !== undefined) return;
    canvas.setPointerCapture(event.pointerId);
    activePointer = event.pointerId;
    lastEvent = event;
    try {
      handlers.down(event);
    } catch (error) {
      activePointer = undefined;
      lastEvent = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      throw error;
    }
  };
  const move = (event: PointerEvent): void => {
    if (activePointer === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
      lastEvent = event;
      handlers.move(event);
    }
  };
  const up = (event: PointerEvent): void => {
    if (activePointer === event.pointerId) finish(event);
  };
  const cancel = (event: PointerEvent): void => {
    if (activePointer === event.pointerId)
      finish(event, event.type as 'pointercancel' | 'lostpointercapture');
  };
  for (const [name, callback] of [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', cancel],
    ['lostpointercapture', cancel],
  ] as const) {
    canvas.addEventListener(name, callback);
    scope.own(() => canvas.removeEventListener(name, callback));
  }
  const view = canvas.ownerDocument?.defaultView;
  const blur = (event: Event): void => finish(event, 'blur');
  view?.addEventListener('blur', blur);
  scope.own(() => {
    view?.removeEventListener('blur', blur);
    finish(new Event('dispose'), 'dispose');
  });
}
