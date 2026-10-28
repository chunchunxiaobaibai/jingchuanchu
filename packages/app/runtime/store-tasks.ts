import { Cancellation, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ComponentOwner } from './component-owner.js';
import { batch } from './scheduler.js';
import { reportApplicationError } from './errors.js';

export type StoreTaskResult<T> =
  { readonly status: 'completed'; readonly value: T } | { readonly status: 'cancelled' };
export type StoreCommitResult<T> =
  { readonly status: 'committed'; readonly value: T } | { readonly status: 'cancelled' };
type SynchronousCommit<T> = (() => T) &
  ([T] extends [never]
    ? unknown
    : [Extract<T, PromiseLike<unknown>>] extends [never]
      ? unknown
      : never);
export interface StoreTaskContext {
  readonly signal: CancellationSignal;
  commit<T>(run: SynchronousCommit<T>): StoreCommitResult<T>;
}
export interface StoreTaskOptions {
  readonly key?: PropertyKey;
}
interface PendingTask {
  cancel(reason: unknown): void;
}

/** The task gate controls submissions and waiting, not arbitrary writes in user Promise callbacks. */
export class StoreTasks {
  private epoch = 0;
  private invalidating = false;
  private readonly pending = new Set<PendingTask>();
  private readonly keyed = new Map<PropertyKey, PendingTask>();
  constructor(
    private readonly owner: ComponentOwner,
    private readonly error: (operation: string, cause: unknown) => Error,
  ) {
    owner.scope.own(() => this.invalidate('dispose'));
  }
  invalidate(reason: string): void {
    this.epoch++;
    const errors: unknown[] = [];
    this.invalidating = true;
    try {
      for (const task of [...this.pending])
        try {
          task.cancel(new Error(`Store task ${reason}`));
        } catch (error) {
          errors.push(error);
        }
    } finally {
      this.invalidating = false;
    }
    if (errors.length) throw this.error('task cancellation', new AggregateError(errors));
  }
  run<T>(
    run: (context: StoreTaskContext) => T | PromiseLike<T>,
    options: StoreTaskOptions = {},
  ): Promise<StoreTaskResult<T>> {
    return new Promise((resolve, reject) => {
      let live = true;
      const cancellation = new Cancellation(),
        epoch = this.epoch,
        key = options.key;
      const current = () => live && !this.owner.disposed && this.epoch === epoch;
      const finish = () => {
        live = false;
        this.pending.delete(task);
        if (key !== undefined && this.keyed.get(key) === task) this.keyed.delete(key);
      };
      const task: PendingTask = {
        cancel: (reason) => {
          if (!live) return;
          finish();
          resolve({ status: 'cancelled' });
          cancellation.cancel(reason);
        },
      };
      const fail = (error: unknown) => {
        if (!live) return;
        finish();
        reject(this.error('task', error));
      };
      try {
        this.owner.assertOpen();
        if (this.invalidating) {
          live = false;
          resolve({ status: 'cancelled' });
          return;
        }
        const previous = key === undefined ? undefined : this.keyed.get(key);
        this.pending.add(task);
        if (key !== undefined) this.keyed.set(key, task);
        try {
          previous?.cancel(new Error('Store task superseded'));
        } catch (error) {
          if (live) {
            finish();
            reject(this.error('task supersede', error));
          } else reportApplicationError(this.error('task supersede', error));
          return;
        }
        if (!current()) return;
        const context: StoreTaskContext = {
          signal: cancellation,
          commit: <R>(commit: SynchronousCommit<R>): StoreCommitResult<R> => {
            if (!current()) return { status: 'cancelled' };
            try {
              const value = batch(commit);
              if (value && typeof (value as unknown as PromiseLike<unknown>).then === 'function') {
                void Promise.resolve(value).catch(() => {});
                throw new Error('Store commit callbacks must be synchronous');
              }
              return { status: 'committed', value };
            } catch (error) {
              throw this.error('commit', error);
            }
          },
        };
        Promise.resolve(run(context)).then((value) => {
          if (!live) return;
          if (!current()) {
            finish();
            resolve({ status: 'cancelled' });
            return;
          }
          finish();
          resolve({ status: 'completed', value });
        }, fail);
      } catch (error) {
        if (!live) {
          reject(this.error('task', error));
          return;
        }
        finish();
        reject(this.error('task', error));
      }
    });
  }
}
