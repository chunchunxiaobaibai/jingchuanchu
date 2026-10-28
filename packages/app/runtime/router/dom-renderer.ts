import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { PageDefinition, InputMap, OutputMap, ModelMap } from '../component-types.js';
import { ComponentOwner } from '../component-owner.js';
import {
  mountComponent,
  stageComponentInputs,
  type ComponentInstance,
} from '../component-runtime.js';
import { runUntracked, captureSignal, type WritableSignal } from '../reactivity.js';
import { installPageRoute } from './context.js';
import { resolveRouteOutlet, getRouteOutlet, type RouteOutletRegistration } from './outlets.js';
import {
  RouteError,
  type PreparedRoutePage,
  type RouteCandidate,
  type RouteRenderer,
  type RouteLocation,
} from './types.js';

type RuntimePage = PageDefinition<InputMap, OutputMap, ModelMap, Record<string, unknown>>;
interface Frame {
  prepared: PreparedRoutePage;
  readonly host: Element;
  readonly instance: ComponentInstance<Record<string, unknown>, Record<string, unknown>>;
  readonly scopeOwner: ComponentOwner;
  readonly route: WritableSignal<RouteLocation>;
}
interface Candidate extends RouteCandidate {
  readonly frames: readonly Frame[];
  readonly owned: Set<Frame>;
  disposed: boolean;
  forgetPrevious(previous: Candidate): void;
}
const outlets = new WeakSet<Element>();

/** Internal DOM backend. Built-in outlet registration and application assembly follow in T15. */
export function createDOMRouteRenderer(
  outlet: Element,
  owner: ComponentOwner,
  options: { onError?: (error: unknown) => void } = {},
): RouteRenderer & { dispose(): void } {
  owner.assertOpen();
  if (outlets.has(outlet)) throw new Error('Route outlet already has a renderer');
  outlets.add(outlet);
  const original = [...outlet.childNodes];
  const candidates = new Set<Candidate>();
  let current: Candidate | undefined;
  let closed = false;

  function nested(frame: Frame): RouteOutletRegistration {
    return resolveRouteOutlet(frame.instance.owner);
  }

  function dispose(): void {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    for (const candidate of [...candidates].reverse()) {
      try {
        candidate.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      outlet.replaceChildren(...original);
    } catch (error) {
      errors.push(error);
    }
    outlets.delete(outlet);
    if (errors.length) throw new AggregateError(errors, 'Route renderer cleanup failed');
  }
  owner.scope.own(dispose);

  return {
    dispose,
    create(context) {
      owner.assertOpen();
      if (closed) throw new Error('Route renderer is disposed');
      context.signal.throwIfAborted();
      if (!context.views.length) throw new Error('Route candidate requires a page');
      let base = current;
      let previousDisposed = false;
      const frames: Frame[] = [];
      const owned = new Set<Frame>();
      // Layouts follow route/definition identity. A leaf is always recreated.
      const limit = Math.min(
        context.reuseDepth,
        context.views.length - 1,
        (base?.frames.length ?? 0) - 1,
      );
      for (let index = 0; index < limit; index++) {
        const frame = base!.frames[index]!,
          prepared = context.views[index]!;
        if (
          frame.instance.owner.disposed ||
          frame.prepared.record !== prepared.record ||
          frame.prepared.page !== prepared.page
        )
          break;
        frames.push(frame);
      }
      const reused = frames.length;
      let committed = false;
      let rolledBack = false;
      let target: Element;
      const updates: {
        frame: Frame;
        previous: PreparedRoutePage;
        next: PreparedRoutePage;
        apply: () => Cleanup;
      }[] = [];
      try {
        target = reused ? nested(frames[reused - 1]!).host : outlet;
        for (let index = 0; index < reused; index++) {
          const frame = frames[index]!,
            next = context.views[index]!;
          updates.push({
            frame,
            previous: frame.prepared,
            next,
            apply: stageComponentInputs(frame.instance, frame.prepared.inputs, next.inputs),
          });
        }
        for (const prepared of context.views.slice(reused)) {
          context.signal.throwIfAborted();
          const host = outlet.ownerDocument.createElement(prepared.page.selector);
          const parent = frames.at(-1);
          const scopeOwner = new ComponentOwner(
            parent ? nested(parent).owner : (getRouteOutlet(outlet)?.owner ?? owner),
          );
          let frame: Frame;
          try {
            const route = installPageRoute(scopeOwner, context.to);
            const instance = runUntracked(() =>
              mountComponent(host, prepared.page as RuntimePage, {
                owner: scopeOwner,
                inputs: prepared.inputs,
                ...options,
              }),
            );
            frame = { prepared, host, instance, scopeOwner, route };
          } catch (error) {
            try {
              scopeOwner.dispose();
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                'Page context setup and cleanup failed',
              );
            }
            throw error;
          }
          owned.add(frame);
          // Owner teardown also removes the wrapper, even if the Router was not explicitly disposed.
          frame.instance.owner.scope.own(() => host.remove());
          if (frames.length > reused) nested(parent!).host.replaceChildren(host);
          frames.push(frame);
        }
        context.signal.throwIfAborted();
      } catch (error) {
        const errors = [error];
        for (const frame of [...owned].reverse()) {
          try {
            frame.scopeOwner.dispose();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
        throw new RouteError(
          context.to.name ?? context.to.path,
          'DOM candidate',
          errors.length === 1 ? error : new AggregateError(errors),
        );
      }

      const candidate: Candidate = {
        frames,
        owned,
        disposed: false,
        forgetPrevious(previous) {
          if (base !== previous) return;
          base = undefined;
          previousDisposed = true;
        },
        commit(): Cleanup {
          owner.assertOpen();
          context.signal.throwIfAborted();
          if (
            closed ||
            candidate.disposed ||
            committed ||
            rolledBack ||
            previousDisposed ||
            current !== base
          )
            throw new Error('Route candidate is no longer available for commit');
          for (const frame of frames) frame.instance.owner.assertOpen();
          if (reused && !frames[reused - 1]!.host.contains(target))
            throw new Error('Retained route outlet was removed before commit');
          if (reused && nested(frames[reused - 1]!).host !== target)
            throw new Error('Retained route outlet changed before commit');
          const previousNodes = [...target.childNodes];
          const undoInputs: Cleanup[] = [];
          const restoreInputs = (): void => {
            const errors: unknown[] = [];
            for (const undo of [...undoInputs].reverse()) {
              try {
                undo();
              } catch (error) {
                errors.push(error);
              }
            }
            for (const update of updates) update.frame.prepared = update.previous;
            if (errors.length)
              throw new AggregateError(errors, 'Retained page input rollback failed');
          };
          try {
            for (const update of updates) {
              undoInputs.push(captureSignal(update.frame.route));
              undoInputs.push(update.apply());
              update.frame.route.set(context.to);
            }
            target.replaceChildren(frames[reused]!.host);
          } catch (error) {
            const errors = [error];
            for (const restore of [() => target.replaceChildren(...previousNodes), restoreInputs]) {
              try {
                restore();
              } catch (rollbackError) {
                errors.push(rollbackError);
              }
            }
            if (errors.length > 1)
              throw new AggregateError(errors, 'Route DOM commit and rollback failed');
            throw error;
          }
          for (const update of updates) update.frame.prepared = update.next;
          for (const frame of frames.slice(0, reused)) {
            base!.owned.delete(frame);
            owned.add(frame);
          }
          current = candidate;
          committed = true;
          return () => {
            if (rolledBack) return;
            if (candidate.disposed || current !== candidate || previousDisposed)
              throw new Error('Route candidate can no longer roll back');
            const errors: unknown[] = [];
            for (const restore of [() => target.replaceChildren(...previousNodes), restoreInputs]) {
              try {
                restore();
              } catch (error) {
                errors.push(error);
              }
            }
            for (const frame of frames.slice(0, reused)) {
              owned.delete(frame);
              base!.owned.add(frame);
            }
            current = base;
            rolledBack = true;
            if (errors.length) throw new AggregateError(errors, 'Route view rollback failed');
          };
        },
        dispose() {
          if (candidate.disposed) return;
          candidate.disposed = true;
          candidates.delete(candidate);
          for (const other of candidates) other.forgetPrevious(candidate);
          base = undefined;
          const errors: unknown[] = [];
          if (current === candidate) {
            current = undefined;
            try {
              outlet.replaceChildren(...original);
            } catch (error) {
              errors.push(error);
            }
          }
          for (const frame of [...owned].reverse()) {
            try {
              frame.scopeOwner.dispose();
            } catch (error) {
              errors.push(error);
            }
          }
          owned.clear();
          frames.length = 0;
          if (errors.length) throw new AggregateError(errors, 'Route candidate cleanup failed');
        },
      };
      candidates.add(candidate);
      return candidate;
    },
  };
}
