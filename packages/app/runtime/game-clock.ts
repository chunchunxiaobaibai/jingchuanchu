import { TweenQueue, type TweenValue, type TweenOptions, type TweenHandle } from './tweens.js';
import type { Scope } from '@xiaobaibaifqy/jingchuanchu-core';

export type GameTimerStatus = 'pending' | 'completed' | 'cancelled' | 'failed';
export interface GameTimer {
  readonly status: GameTimerStatus;
  cancel(): void;
}
export interface GameClock {
  readonly disposed: boolean;
  tween<T extends TweenValue>(options: TweenOptions<T>): TweenHandle;
  after(seconds: number, callback: () => void): GameTimer;
  every(seconds: number, callback: () => void): GameTimer;
  advance(delta: number): void;
  setActive(active: boolean): void;
  dispose(): void;
}
export class GameClockError extends Error {
  readonly module = 'game-feedback';
  constructor(
    readonly source: string,
    readonly operation: string,
    readonly taskId: number | null,
    cause: unknown,
  ) {
    super(
      `Clock ${source}${taskId === null ? '' : ` task ${taskId}`}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'GameClockError';
  }
}
interface Task {
  readonly id: number;
  readonly seconds: number;
  readonly repeat: boolean;
  readonly callback: () => void;
  remaining: number;
  status: GameTimerStatus;
}

/** A scene-owned clock advanced only by its existing Engine fixed-step system. */
export function createGameClock(options: { scope: Scope; source?: string }): GameClock {
  const source = options.source ?? 'game-clock';
  if (typeof source !== 'string' || !source.trim())
    throw new GameClockError('game-clock', 'create', null, new Error('Source must be nonempty'));
  const tasks = new Map<number, Task>();
  const tweens = new TweenQueue(source);
  let closed = false,
    active = true,
    advancing = false,
    nextId = 0;
  const fail = (operation: string, cause: unknown, taskId: number | null = null): GameClockError =>
    new GameClockError(source, operation, taskId, cause);
  const assertOpen = (operation: string): void => {
    if (closed) throw fail(operation, new Error('Clock is disposed'));
  };
  const cancel = (task: Task): void => {
    if (task.status !== 'pending') return;
    task.status = 'cancelled';
    tasks.delete(task.id);
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    tweens.dispose();
    for (const task of tasks.values()) cancel(task);
  };
  options.scope.own(dispose);
  assertOpen('create');
  const register = (seconds: number, callback: () => void, repeat: boolean): GameTimer => {
    const operation = repeat ? 'every' : 'after';
    assertOpen(operation);
    if (!Number.isFinite(seconds) || seconds <= 0 || typeof callback !== 'function')
      throw fail(
        operation,
        new Error('Positive finite seconds and a synchronous callback are required'),
      );
    const task: Task = {
      id: ++nextId,
      seconds,
      remaining: seconds,
      callback,
      repeat,
      status: 'pending',
    };
    tasks.set(task.id, task);
    return Object.freeze({
      get status() {
        return task.status;
      },
      cancel() {
        cancel(task);
      },
    });
  };
  return Object.freeze({
    get disposed() {
      return closed;
    },
    tween<T extends TweenValue>(options: TweenOptions<T>) {
      return tweens.tween(options);
    },
    after(seconds: number, callback: () => void) {
      return register(seconds, callback, false);
    },
    every(seconds: number, callback: () => void) {
      return register(seconds, callback, true);
    },
    setActive(value: boolean) {
      if (!closed) active = value;
    },
    dispose,
    advance(delta: number): void {
      assertOpen('advance');
      if (!Number.isFinite(delta) || delta < 0)
        throw fail('advance', new Error('Delta must be finite and nonnegative'));
      if (advancing) throw fail('advance', new Error('Clock advance is not reentrant'));
      if (!active || delta === 0) return;
      advancing = true;
      try {
        const batch = [...tasks.values()];
        const updateTweens = tweens.capture(delta, () => active && !closed);
        // Everyone in this step ages together, even if a callback interrupts dispatch.
        for (const task of batch) task.remaining -= delta;
        for (const task of batch) {
          if (closed || !active) break;
          if (
            task.status !== 'pending' ||
            task.remaining > Number.EPSILON * 8 * Math.max(task.seconds, delta)
          )
            continue;
          if (task.repeat)
            task.remaining = task.seconds - (Math.max(0, -task.remaining) % task.seconds);
          else {
            task.status = 'completed';
            tasks.delete(task.id);
          }
          try {
            const result: unknown = task.callback();
            if (
              result !== null &&
              (typeof result === 'object' || typeof result === 'function') &&
              typeof (result as PromiseLike<unknown>).then === 'function'
            ) {
              void Promise.resolve(result).catch(() => {});
              throw new Error('Timer callbacks must be synchronous');
            }
          } catch (error) {
            task.status = 'failed';
            tasks.delete(task.id);
            throw fail(task.repeat ? 'every.callback' : 'after.callback', error, task.id);
          }
        }
        updateTweens();
      } finally {
        advancing = false;
      }
    },
  });
}
