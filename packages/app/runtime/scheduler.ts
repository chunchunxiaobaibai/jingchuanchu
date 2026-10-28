import { reportHostError } from './errors.js';

export interface ReactiveJob {
  readonly label: string;
  run(): void;
  onError(error: unknown): void;
  onCycle(error: unknown): void;
}

const pending = new Set<ReactiveJob>();
const executions = new Map<ReactiveJob, number>();
const settled = new Set<() => void>();
let scheduled = false;
let batchDepth = 0;
let flushing = false;

function schedule(): void {
  if (scheduled || flushing || batchDepth || !pending.size) return;
  scheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  scheduled = false;
  flushing = true;
  const current = [...pending];
  pending.clear();
  for (const job of current) {
    const count = (executions.get(job) ?? 0) + 1;
    executions.set(job, count);
    try {
      if (count > 100)
        job.onCycle(new Error(`${job.label}: Reactive update cycle exceeded 100 batches`));
      else {
        try {
          job.run();
        } catch (error) {
          job.onError(error);
        }
      }
    } catch (error) {
      reportHostError(error);
    }
  }
  flushing = false;
  if (!pending.size) {
    executions.clear();
    for (const resolve of settled) resolve();
    settled.clear();
  }
  schedule();
}

export function queueReactiveJob(job: ReactiveJob): void {
  pending.add(job);
  schedule();
}

export function cancelReactiveJob(job: ReactiveJob): void {
  pending.delete(job);
}

export function batch<T>(run: () => T): T {
  batchDepth++;
  try {
    return run();
  } finally {
    batchDepth--;
    schedule();
  }
}

/** Wait for currently scheduled work and the further batches it schedules, never network/game frames. */
export function nextTick(): Promise<void> {
  if (!pending.size && !flushing) return Promise.resolve();
  return new Promise((resolve) => settled.add(resolve));
}
