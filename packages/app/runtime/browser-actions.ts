import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { bindPointer } from '@xiaobaibaifqy/jingchuanchu-input';
import {
  ActionError,
  ActionSampler,
  type ActionDefinitions,
  type ActionEntries,
  type ActionSnapshot,
  type AxisAction,
} from './input-actions.js';
import type { Viewport } from './viewport.js';

export interface Actions<A extends ActionEntries> {
  readonly disposed: boolean;
  read(): ActionSnapshot<A>;
  setVirtual<K extends keyof A & string>(
    key: K,
    value: A[K] extends AxisAction ? number : boolean,
    source?: string,
  ): void;
  clear(): void;
  setActive(active: boolean): void;
  dispose(): void;
}
const owners = new WeakSet<HTMLCanvasElement>();

function element(target: EventTarget | null): Element | null {
  return target && (target as Node).nodeType === 1 ? (target as Element) : null;
}
function editable(target: EventTarget | null): boolean {
  const nearest = element(target)?.closest('input,textarea,select,[contenteditable]');
  return (
    !!nearest &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(nearest.tagName) ||
      (nearest.hasAttribute('contenteditable') &&
        nearest.getAttribute('contenteditable') !== 'false'))
  );
}
function interactive(target: EventTarget | null): boolean {
  return editable(target) || !!element(target)?.closest('button,a[href],[role="button"]');
}

/** Scope-owned DOM adapter. The game loop decides when to consume each snapshot. */
export function createActions<A extends ActionEntries>(options: {
  definition: ActionDefinitions<A>;
  canvas: HTMLCanvasElement;
  viewport: Viewport;
  scope: Scope;
  host?: HTMLElement;
}): Actions<A> {
  const { canvas, viewport, scope, definition } = options;
  const host = options.host ?? canvas.parentElement ?? canvas;
  const document = canvas.ownerDocument,
    view = document?.defaultView;
  if (!view || host.ownerDocument !== document || !host.contains(canvas) || viewport.disposed)
    throw new ActionError(
      '<actions>',
      'create',
      new Error('Live viewport and containing host in a window are required'),
    );
  if (owners.has(canvas))
    throw new ActionError('<actions>', 'create', new Error('Canvas already has actions'));
  const sampler = new ActionSampler(definition);
  const events = new Scope();
  let pointer: Scope | undefined,
    enabled = true,
    closed = false,
    composing = false,
    focused = true,
    adopted = false,
    clearing = false;
  const oldTab = canvas.getAttribute('tabindex');
  const oldTouch = canvas.style.getPropertyValue('touch-action');
  const oldTouchPriority = canvas.style.getPropertyPriority('touch-action');
  const prevent = new Set<string>();
  const preventPointer = Object.values(definition.entries).some(
    (entry) => entry.kind === 'button' && entry.pointer === 'primary' && entry.preventDefault,
  );
  for (const entry of Object.values(definition.entries)) {
    if (!entry.preventDefault) continue;
    for (const code of entry.kind === 'axis'
      ? [...entry.negative, ...entry.positive]
      : (entry.keys ?? []))
      prevent.add(code);
  }
  const available = (): boolean =>
    !closed &&
    enabled &&
    focused &&
    !composing &&
    document.visibilityState !== 'hidden' &&
    !viewport.disposed;
  const allowed = (): boolean => available() && !editable(document.activeElement);
  const keyboardAllowed = (event: KeyboardEvent): boolean =>
    allowed() &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event
      .composedPath()
      .some((target) => target === host || (!!element(target) && host.contains(element(target)))) &&
    !event.composedPath().some(interactive);
  const bind = (): void => {
    if (closed || !enabled) return;
    const binding = (pointer = new Scope());
    bindPointer(
      canvas,
      {
        accept(event) {
          if (!available() || event.composedPath().some(interactive)) return false;
          if (!viewport.toGamePoint(event).inside) return false;
          canvas.focus({ preventScroll: true });
          return allowed();
        },
        down(event) {
          if (preventPointer) event.preventDefault();
          sampler.setPointer(viewport.toGamePoint(event), true);
        },
        move(event) {
          if (preventPointer) event.preventDefault();
          sampler.setPointer(viewport.toGamePoint(event), true);
        },
        up(event) {
          if (preventPointer) event.preventDefault();
          sampler.setPointer(viewport.toGamePoint(event), false);
        },
        cancel() {
          clear();
        },
      },
      binding,
    );
  };
  const clear = (): void => {
    if (clearing) return;
    clearing = true;
    const previous = pointer;
    pointer = undefined;
    // Clear state even if capture release fails; keep the adapter recoverable.
    try {
      previous?.dispose();
    } finally {
      sampler.clear();
      clearing = false;
      if (!pointer) bind();
    }
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    for (const cleanup of [
      () => pointer?.dispose(),
      () => events.dispose(),
      () => sampler.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    pointer = undefined;
    if (adopted) {
      owners.delete(canvas);
      if (oldTab === null && canvas.getAttribute('tabindex') === '0')
        canvas.removeAttribute('tabindex');
      if (
        canvas.style.getPropertyValue('touch-action') === 'none' &&
        canvas.style.getPropertyPriority('touch-action') === ''
      ) {
        if (oldTouch) canvas.style.setProperty('touch-action', oldTouch, oldTouchPriority);
        else canvas.style.removeProperty('touch-action');
      }
    }
    if (errors.length) throw new ActionError('<actions>', 'dispose', new AggregateError(errors));
  };
  scope.own(dispose);
  if (closed) throw new ActionError('<actions>', 'create', new Error('Scope is disposed'));
  owners.add(canvas);
  adopted = true;
  const on = (target: EventTarget, type: string, callback: EventListener): void => {
    target.addEventListener(type, callback);
    events.own(() => target.removeEventListener(type, callback));
  };
  try {
    if (oldTab === null) canvas.setAttribute('tabindex', '0');
    canvas.style.setProperty('touch-action', 'none');
    on(view, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.isComposing || key.keyCode === 229 || key.ctrlKey || key.metaKey || key.altKey) {
        clear();
        return;
      }
      if (!keyboardAllowed(key)) return;
      // An OS repeat after a clear must not recreate a held key.
      if (key.repeat) {
        if (prevent.has(key.code)) key.preventDefault();
        return;
      }
      sampler.setKey(key.code, true);
      if (prevent.has(key.code)) key.preventDefault();
    });
    on(view, 'keyup', (event) => sampler.setKey((event as KeyboardEvent).code, false));
    on(view, 'blur', () => {
      focused = false;
      composing = false;
      clear();
    });
    on(view, 'focus', () => {
      focused = true;
    });
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') clear();
    });
    on(document, 'focusin', (event) => {
      if (!host.contains(element(event.target)) || event.composedPath().some(editable)) clear();
    });
    on(document, 'focusout', (event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (!host.contains(element(next)) || editable(next)) clear();
    });
    on(document, 'compositionstart', () => {
      composing = true;
      clear();
    });
    on(document, 'compositionend', () => {
      composing = false;
    });
    bind();
  } catch (error) {
    try {
      dispose();
    } catch (cleanup) {
      throw new ActionError('<actions>', 'create', new AggregateError([error, cleanup]));
    }
    throw new ActionError('<actions>', 'create', error);
  }
  return Object.freeze({
    get disposed() {
      return closed;
    },
    read() {
      if (!closed && !allowed()) clear();
      return sampler.read();
    },
    setVirtual<K extends keyof A & string>(
      key: K,
      value: A[K] extends AxisAction ? number : boolean,
      source?: string,
    ) {
      if (closed) throw new ActionError(String(key), 'virtual', new Error('Actions are disposed'));
      if (allowed()) sampler.setVirtual(key, value, source);
    },
    clear,
    setActive(active: boolean) {
      if (closed) return;
      enabled = active;
      if (!active) clear();
      else if (!pointer) bind();
    },
    dispose,
  });
}
