import { snapshot, type ReadonlyData } from '../state.js';
import type { GamePoint } from './viewport.js';
const ACTIONS = Symbol('input actions');
export interface AxisAction {
  readonly kind: 'axis';
  readonly negative: readonly string[];
  readonly positive: readonly string[];
  readonly preventDefault?: boolean;
}
export interface ButtonAction {
  readonly kind: 'button';
  readonly keys?: readonly string[];
  readonly pointer?: 'primary';
  readonly preventDefault?: boolean;
}
export type ActionEntry = AxisAction | ButtonAction;
export type ActionEntries = Readonly<Record<string, ActionEntry>>;
export interface ActionDefinitions<A extends ActionEntries> {
  readonly [ACTIONS]: true;
  readonly entries: ReadonlyData<A>;
}
export interface ButtonSnapshot {
  readonly down: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
}
export interface ActionSnapshot<A extends ActionEntries> {
  readonly axes: { readonly [K in keyof A as A[K] extends AxisAction ? K : never]: number };
  readonly buttons: {
    readonly [K in keyof A as A[K] extends ButtonAction ? K : never]: ButtonSnapshot;
  };
  readonly pointer: ButtonSnapshot & { readonly point: GamePoint | null };
}
export class ActionError extends Error {
  readonly module = 'viewport-input';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Action ${source}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'ActionError';
  }
}
function codes(value: unknown): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((code) => typeof code === 'string' && code.trim() && !/[\u0000-\u001f]/.test(code))
  )
    throw new Error('Key codes must be a string array');
}
export function defineActions<const A extends ActionEntries>(entries: A): ActionDefinitions<A> {
  if (
    !entries ||
    typeof entries !== 'object' ||
    Array.isArray(entries) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(entries))
  )
    throw new ActionError('<actions>', 'define', new Error('Expected an action record'));
  for (const [key, entry] of Object.entries(entries as ActionEntries)) {
    try {
      if (!key.trim() || /[\u0000-\u001f]/.test(key))
        throw new Error('Action name must be nonempty');
      if (!entry || !['axis', 'button'].includes(entry.kind))
        throw new Error('Unknown action kind');
      if (entry.preventDefault !== undefined && typeof entry.preventDefault !== 'boolean')
        throw new Error('preventDefault must be boolean');
      if (entry.kind === 'axis') {
        codes(entry.negative);
        codes(entry.positive);
        if (entry.positive.some((code) => entry.negative.includes(code)))
          throw new Error('Axis key cannot be positive and negative');
      } else {
        if (entry.keys !== undefined) codes(entry.keys);
        if (entry.pointer !== undefined && entry.pointer !== 'primary')
          throw new Error('Only the primary pointer is supported');
      }
    } catch (error) {
      throw new ActionError(key, 'define', error);
    }
  }
  return Object.freeze({ [ACTIONS]: true as const, entries: snapshot(entries) });
}

/** Internal fixed-step state shared by the DOM adapter and injected tests. */
export class ActionSampler<A extends ActionEntries> {
  private readonly keys = new Set<string>();
  private readonly virtual = new Map<string, Map<string, number | boolean>>();
  private readonly down = new Map<string, boolean>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private pointerDown = false;
  private pointerPressed = false;
  private pointerReleased = false;
  private point: GamePoint | null = null;
  private active = true;
  private closed = false;
  private readonly entries: ActionEntries;
  private readonly orderedEntries: Array<[string, ActionEntry]>;
  constructor(definition: ActionDefinitions<A>) {
    if (definition[ACTIONS] !== true)
      throw new ActionError('<actions>', 'create', new Error('Expected defineActions(...)'));
    this.entries = definition.entries as ActionEntries;
    this.orderedEntries = Object.entries(this.entries);
  }
  private buttons(): void {
    for (const [key, entry] of this.orderedEntries) {
      if (entry.kind !== 'button') continue;
      let current =
        (entry.keys?.some((code) => this.keys.has(code)) ?? false) ||
        (entry.pointer === 'primary' && this.pointerDown);
      const sources = this.virtual.get(key);
      if (!current && sources)
        for (const value of sources.values())
          if (value) {
            current = true;
            break;
          }
      const previous = this.down.get(key) ?? false;
      if (current && !previous) this.pressed.add(key);
      if (!current && previous) this.released.add(key);
      this.down.set(key, current);
    }
  }
  setKey(code: string, down: boolean): void {
    if (this.closed || !this.active) return;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    this.buttons();
  }
  setVirtual<K extends keyof A & string>(
    key: K,
    value: A[K] extends AxisAction ? number : boolean,
    source = 'default',
  ): void {
    if (this.closed || !this.active) return;
    const entry = this.entries[key];
    if (!Object.hasOwn(this.entries, key) || !entry || !source.trim())
      throw new ActionError(key, 'virtual', new Error('Unknown action/source'));
    if (
      entry.kind === 'axis'
        ? typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1
        : typeof value !== 'boolean'
    )
      throw new ActionError(
        key,
        'virtual',
        new Error('Axis requires [-1,1], button requires boolean'),
      );
    const values = this.virtual.get(key) ?? new Map<string, number | boolean>();
    if (value === 0 || value === false) values.delete(source);
    else values.set(source, value);
    if (values.size) this.virtual.set(key, values);
    else this.virtual.delete(key);
    this.buttons();
  }
  setPointer(point: GamePoint, down: boolean): void {
    if (this.closed || !this.active) return;
    if (![point.x, point.y].every(Number.isFinite) || typeof point.inside !== 'boolean')
      throw new ActionError('pointer', 'point', new Error('Invalid game point'));
    // Copy once when pointer state changes, rather than cloning it every fixed
    // step. Only this deeply immutable leaf is shared by later snapshots.
    this.point = snapshot(point);
    const current = down && (this.pointerDown || point.inside);
    if (current && !this.pointerDown) this.pointerPressed = true;
    if (!current && this.pointerDown) this.pointerReleased = true;
    this.pointerDown = current;
    this.buttons();
  }
  read(): ActionSnapshot<A> {
    if (this.closed) throw new ActionError('<actions>', 'read', new Error('Actions are disposed'));
    const axes: Record<string, number> = Object.create(null),
      buttons: Record<string, ButtonSnapshot> = Object.create(null);
    for (const [key, entry] of this.orderedEntries) {
      if (entry.kind === 'axis') {
        const keyboard =
          Number(entry.positive.some((code) => this.keys.has(code))) -
          Number(entry.negative.some((code) => this.keys.has(code)));
        let virtual = 0;
        const sources = this.virtual.get(key);
        if (sources) for (const value of sources.values()) virtual += Number(value);
        axes[key] = Math.max(-1, Math.min(1, keyboard + virtual));
      } else
        buttons[key] = Object.freeze({
          down: this.down.get(key) ?? false,
          pressed: this.pressed.has(key),
          released: this.released.has(key),
        });
    }
    // The output schema is fixed and every nested value is built here or is
    // already frozen. Keep ordinary own-property records, including special
    // action names, without a general-purpose structured clone of the tree.
    const value = Object.freeze({
      axes: Object.freeze({ ...axes }),
      buttons: Object.freeze({ ...buttons }),
      pointer: Object.freeze({
        down: this.pointerDown,
        pressed: this.pointerPressed,
        released: this.pointerReleased,
        point: this.point,
      }),
    });
    this.pressed.clear();
    this.released.clear();
    this.pointerPressed = false;
    this.pointerReleased = false;
    return value as ActionSnapshot<A>;
  }
  clear(): void {
    this.keys.clear();
    this.virtual.clear();
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.pointerDown = false;
    this.pointerPressed = false;
    this.pointerReleased = false;
    this.point = null;
  }
  setActive(active: boolean): void {
    if (this.closed) return;
    this.active = active;
    if (!active) this.clear();
  }
  dispose(): void {
    if (this.closed) return;
    this.clear();
    this.closed = true;
  }
}
