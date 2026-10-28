export type TweenEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type TweenValue = number | Readonly<Record<string, number>>;
export type TweenOutput<T extends TweenValue> = T extends number
  ? number
  : { readonly [K in keyof T]: number };
export type TweenStatus = 'pending' | 'completed' | 'cancelled' | 'failed';
export interface TweenHandle {
  readonly status: TweenStatus;
  cancel(): void;
}
export interface TweenOptions<T extends TweenValue> {
  readonly from: T;
  readonly to: TweenOutput<NoInfer<T>>;
  readonly duration: number;
  readonly easing?: TweenEasing;
  readonly onUpdate: (value: TweenOutput<NoInfer<T>>) => void;
  readonly onComplete?: () => void;
}
export class TweenError extends Error {
  readonly module = 'game-feedback';
  constructor(
    readonly source: string,
    readonly operation: string,
    readonly taskId: number | null,
    cause: unknown,
  ) {
    super(
      `Tween ${source}${taskId === null ? '' : ` task ${taskId}`}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'TweenError';
  }
}
interface Task {
  readonly id: number;
  readonly from: TweenValue;
  readonly to: TweenValue;
  readonly duration: number;
  readonly easing: TweenEasing;
  readonly update: (value: TweenValue) => void;
  readonly complete: (() => void) | undefined;
  elapsed: number;
  status: TweenStatus;
}
const easings = {
  linear: (t: number) => t,
  'ease-in': (t: number) => t * t,
  'ease-out': (t: number) => t * (2 - t),
  'ease-in-out': (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
} satisfies Record<TweenEasing, (t: number) => number>;
function copy(value: TweenValue): TweenValue {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Endpoints must be finite');
    return value;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Endpoint must be a number or plain numeric record');
  if (
    !Object.keys(value).length ||
    !Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    throw new Error('Endpoint record must have finite numeric fields');
  return Object.freeze({ ...value });
}
function interpolate(task: Task, progress: number): TweenValue {
  const amount = easings[task.easing](progress);
  const lerp = (from: number, to: number) =>
    progress >= 1 ? to : (1 - amount) * from + amount * to;
  if (typeof task.from === 'number') return lerp(task.from, task.to as number);
  const target = task.to as Readonly<Record<string, number>>;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(task.from).map(([key, value]) => [key, lerp(value, target[key]!)]),
    ),
  );
}
function invoke(callback: () => void): void {
  const value: unknown = callback();
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => {});
    throw new Error('Tween callbacks must be synchronous');
  }
}

/** Internal queue; the clock captures this batch before dispatching any timer callback. */
export class TweenQueue {
  private readonly tasks = new Map<number, Task>();
  private closed = false;
  private nextId = 0;
  constructor(private readonly source: string) {}
  private fail(operation: string, cause: unknown, taskId: number | null = null): TweenError {
    return new TweenError(this.source, operation, taskId, cause);
  }
  private cancel(task: Task): void {
    if (task.status !== 'pending') return;
    task.status = 'cancelled';
    this.tasks.delete(task.id);
  }
  tween<T extends TweenValue>(options: TweenOptions<T>): TweenHandle {
    if (this.closed) throw this.fail('create', new Error('Clock is disposed'));
    let from: TweenValue, to: TweenValue;
    try {
      from = copy(options.from);
      to = copy(options.to);
      if (
        typeof from !== typeof to ||
        (typeof from !== 'number' &&
          (Object.keys(from).length !== Object.keys(to).length ||
            !Object.keys(from).every((key) =>
              Object.hasOwn(to as Readonly<Record<string, number>>, key),
            )))
      )
        throw new Error('Endpoint kinds and field names must match');
      if (!Number.isFinite(options.duration) || options.duration <= 0)
        throw new Error('Duration must be positive and finite');
      if (!Object.hasOwn(easings, options.easing ?? 'linear')) throw new Error('Unknown easing');
      if (
        typeof options.onUpdate !== 'function' ||
        (options.onComplete !== undefined && typeof options.onComplete !== 'function')
      )
        throw new Error('Synchronous callbacks are required');
    } catch (error) {
      throw this.fail('create', error);
    }
    const task: Task = {
      id: ++this.nextId,
      from,
      to,
      duration: options.duration,
      easing: options.easing ?? 'linear',
      update: options.onUpdate as (value: TweenValue) => void,
      complete: options.onComplete,
      elapsed: 0,
      status: 'pending',
    };
    this.tasks.set(task.id, task);
    return Object.freeze({
      get status() {
        return task.status;
      },
      cancel: () => this.cancel(task),
    });
  }
  capture(delta: number, active: () => boolean): () => void {
    const batch = [...this.tasks.values()];
    for (const task of batch) task.elapsed = Math.min(task.duration, task.elapsed + delta);
    return () => {
      for (const task of batch) {
        if (this.closed || !active()) break;
        if (task.status !== 'pending') continue;
        const progress =
          task.duration - task.elapsed <= Number.EPSILON * 8 * task.duration
            ? 1
            : task.elapsed / task.duration;
        let operation = 'update';
        try {
          invoke(() => task.update(interpolate(task, progress)));
          if (task.status !== 'pending' || this.closed) continue;
          if (progress >= 1) {
            task.status = 'completed';
            this.tasks.delete(task.id);
            operation = 'complete';
            if (task.complete) invoke(task.complete);
          }
        } catch (error) {
          task.status = 'failed';
          this.tasks.delete(task.id);
          throw this.fail(operation, error, task.id);
        }
      }
    };
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.tasks.values()) this.cancel(task);
  }
}
