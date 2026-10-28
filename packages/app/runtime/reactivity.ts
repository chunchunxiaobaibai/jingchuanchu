import { snapshot, type ReadonlyData } from '../state.js';
import { Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { cancelReactiveJob, queueReactiveJob, type ReactiveJob } from './scheduler.js';
import { reportApplicationError } from './errors.js';

export const SIGNAL = Symbol('application signal');

export interface ReadSignal<T> {
  readonly [SIGNAL]: true;
  (): ReadonlyData<T>;
}

export interface WritableSignal<T> extends ReadSignal<T> {
  set(value: T): void;
  update(reduce: (previous: ReadonlyData<T>) => T): void;
}

const checkpoints = new WeakMap<object, () => Cleanup>();

/** Internal synchronous commit rollback; retains immutable snapshot identity. */
export function captureSignal(signal: WritableSignal<unknown>): Cleanup {
  const capture = checkpoints.get(signal);
  if (!capture) throw new Error('Expected a runtime-owned signal');
  return capture();
}

interface Source {
  readonly label: string;
  readonly dependents: Dependents;
  version: number;
  refresh?: () => void;
}

interface Computation extends Source {
  readonly kind: 'computed' | 'effect';
  dependencies: Set<Source>;
  dirty: boolean;
  evaluating: boolean;
  invalidate?: () => void;
}

const collectedDependents = new FinalizationRegistry<{
  references: Set<WeakRef<Computation>>;
  reference: WeakRef<Computation>;
}>(({ references, reference }) => references.delete(reference));

/** Consumers own their dependencies, but a long-lived source must not own its consumers. */
class Dependents implements Iterable<Computation> {
  private readonly references = new Set<WeakRef<Computation>>();
  private readonly lookup = new WeakMap<Computation, WeakRef<Computation>>();
  add(node: Computation): void {
    if (this.lookup.has(node)) return;
    const reference = new WeakRef(node);
    this.lookup.set(node, reference);
    this.references.add(reference);
    collectedDependents.register(node, { references: this.references, reference }, reference);
  }
  delete(node: Computation): void {
    const reference = this.lookup.get(node);
    if (!reference) return;
    this.lookup.delete(node);
    this.references.delete(reference);
    collectedDependents.unregister(reference);
  }
  *[Symbol.iterator](): Iterator<Computation> {
    for (const reference of this.references) {
      const node = reference.deref();
      if (node) yield node;
      else {
        this.references.delete(reference);
        collectedDependents.unregister(reference);
      }
    }
  }
}

interface Frame {
  readonly node: Computation;
  readonly dependencies: Set<Source>;
  readonly writes: Set<Source>;
  readonly versions: Map<Source, number>;
}

let nextId = 0;
const stack: Frame[] = [];
let trackingBoundary = 0;

/** Internal ownership boundary: child rendering must not subscribe its parent effect. */
export function runUntracked<T>(run: () => T): T {
  const previous = trackingBoundary;
  trackingBoundary = stack.length;
  try {
    return run();
  } finally {
    trackingBoundary = previous;
  }
}

function dependsOn(source: Source, target: Source, seen = new Set<Source>()): boolean {
  if (source === target) return true;
  if (seen.has(source)) return false;
  seen.add(source);
  if ('dependencies' in source) {
    for (const dependency of (source as Computation).dependencies) {
      if (dependsOn(dependency, target, seen)) return true;
    }
  }
  return false;
}

function writeError(node: Computation, source: Source): Error {
  return new Error(`${node.label} cannot write dependency ${source.label} during computation`);
}

function track(source: Source): void {
  const frame = stack.at(-1);
  if (!frame || stack.length <= trackingBoundary) return;
  // Also diagnose writes that happened before a dependency was first read.
  for (const written of frame.node.kind === 'computed' ? frame.writes : []) {
    if (dependsOn(source, written)) throw writeError(frame.node, written);
  }
  frame.dependencies.add(source);
  if (!frame.versions.has(source)) frame.versions.set(source, source.version);
}

function invalidate(source: Source, seen = new Set<Source>()): void {
  if (seen.has(source)) return;
  seen.add(source);
  for (const dependent of source.dependents) {
    // A failed child can already be dirty while its parent cached a fallback.
    dependent.dirty = true;
    dependent.invalidate?.();
    invalidate(dependent, seen);
  }
}

export function signal<T>(initial: T): WritableSignal<T> {
  return createSignal(initial, snapshot);
}
/** Internal identity cell for explicitly declared reference inputs; ordinary state remains data-only. */
export function referenceSignal<T>(initial: T): WritableSignal<T> {
  return createSignal(initial, (value) => value as ReadonlyData<T>);
}
function createSignal<T>(initial: T, copy: (value: T) => ReadonlyData<T>): WritableSignal<T> {
  const source: Source = { label: `signal#${++nextId}`, dependents: new Dependents(), version: 0 };
  let input = initial;
  let current = copy(initial);
  const read = (() => {
    track(source);
    return current;
  }) as WritableSignal<T>;
  Object.defineProperty(read, SIGNAL, { value: true });
  read.set = (value) => {
    if (Object.is(value, input)) return;
    for (const frame of stack) {
      if (frame.node.kind !== 'computed') continue;
      for (const dependency of frame.dependencies) {
        if (dependsOn(dependency, source)) throw writeError(frame.node, source);
      }
    }
    // Clone before committing either identity or value so failed writes leave both intact.
    const next = copy(value);
    for (const frame of stack) frame.writes.add(source);
    input = value;
    current = next;
    source.version++;
    invalidate(source);
  };
  read.update = (reduce) => read.set(reduce(current));
  checkpoints.set(read, () => {
    const previousInput = input,
      previousValue = current;
    return () => {
      if (Object.is(input, previousInput) && Object.is(current, previousValue)) return;
      input = previousInput;
      current = previousValue;
      // Keep versions monotonic: derived readers may have observed the candidate value.
      source.version++;
      invalidate(source);
    };
  });
  return read;
}

export function computed<T>(derive: () => T): ReadSignal<T> {
  const node: Computation = {
    kind: 'computed',
    version: 0,
    label: `computed#${++nextId}${derive.name ? `(${derive.name})` : ''}`,
    dependents: new Dependents(),
    dependencies: new Set(),
    dirty: true,
    evaluating: false,
  };
  let current: ReadonlyData<T>;
  let initialized = false;
  const read = (() => {
    if (node.evaluating) {
      const path = [...stack.map((frame) => frame.node.label), node.label].join(' -> ');
      throw new Error(`Reactive cycle: ${path}`);
    }
    if (node.dirty) {
      const frame: Frame = {
        node,
        dependencies: new Set(),
        writes: new Set(),
        versions: new Map(),
      };
      node.evaluating = true;
      stack.push(frame);
      try {
        const next = snapshot(derive());
        if (!initialized || !Object.is(next, current)) node.version++;
        current = next;
        initialized = true;
        node.dirty = false;
      } finally {
        stack.pop();
        node.evaluating = false;
        for (const dependency of node.dependencies) dependency.dependents.delete(node);
        node.dependencies = frame.dependencies;
        for (const dependency of node.dependencies) dependency.dependents.add(node);
        // A caller may catch this read's error and cache a fallback; it still depends on us.
        track(node);
      }
    } else {
      track(node);
    }
    return current;
  }) as ReadSignal<T>;
  Object.defineProperty(read, SIGNAL, { value: true });
  node.refresh = () => {
    read();
  };
  return read;
}

export interface EffectOptions {
  /** Errors from scheduled work are reported here; manual disposal still throws cleanup errors. */
  onError?: (error: unknown) => void;
}

export function effect(
  run: (onCleanup: (cleanup: Cleanup) => void) => void,
  scope: Scope,
  options: EffectOptions = {},
): Cleanup {
  const node: Computation = {
    kind: 'effect',
    label: `effect#${++nextId}${run.name ? `(${run.name})` : ''}`,
    version: 0,
    dependents: new Dependents(),
    dependencies: new Set(),
    dirty: true,
    evaluating: false,
  };
  let active = true;
  let ran = false;
  let versions = new Map<Source, number>();
  let cleanups: Cleanup[] = [];
  function cleanup(): void {
    const errors: unknown[] = [];
    for (const callback of cleanups.splice(0).reverse()) {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `${node.label}: cleanup failed`);
  }
  function stop(): void {
    if (!active) return;
    active = false;
    cancelReactiveJob(job);
    for (const dependency of node.dependencies) dependency.dependents.delete(node);
    node.dependencies.clear();
    cleanup();
  }
  function report(error: unknown): void {
    const failure = new Error(`${node.label}: effect failed`, { cause: error });
    reportApplicationError(failure, options.onError);
  }
  const job: ReactiveJob = {
    label: node.label,
    run() {
      if (!active) return;
      if (ran) {
        let changed = false;
        for (const dependency of node.dependencies) {
          try {
            dependency.refresh?.();
          } catch {
            changed = true;
          }
          if (versions.get(dependency) !== dependency.version) changed = true;
        }
        if (!changed) return;
      }
      cleanup();
      if (!active) return;
      const frame: Frame = {
        node,
        dependencies: new Set(),
        writes: new Set(),
        versions: new Map(),
      };
      node.dirty = false;
      node.evaluating = true;
      stack.push(frame);
      try {
        const result = run((callback) => {
          if (!active || !node.evaluating)
            throw new Error(`${node.label}: register cleanup synchronously while active`);
          cleanups.push(callback);
        }) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(report);
          throw new Error(
            'Effect callbacks must be synchronous; use explicit cancellable tasks for async work',
          );
        }
      } finally {
        stack.pop();
        node.evaluating = false;
        ran = true;
        versions = frame.versions;
        for (const dependency of node.dependencies) dependency.dependents.delete(node);
        node.dependencies = frame.dependencies;
        if (active) {
          for (const dependency of node.dependencies) dependency.dependents.add(node);
          if (
            [...frame.writes].some((written) =>
              [...node.dependencies].some((dependency) => dependsOn(dependency, written)),
            )
          )
            queueReactiveJob(job);
        } else node.dependencies.clear();
      }
    },
    onError: report,
    onCycle(error) {
      try {
        stop();
      } catch (cleanupError) {
        report(new AggregateError([error, cleanupError]));
        return;
      }
      report(error);
    },
  };
  node.invalidate = () => {
    if (active) queueReactiveJob(job);
  };
  scope.own(stop);
  if (active) queueReactiveJob(job);
  return stop;
}
