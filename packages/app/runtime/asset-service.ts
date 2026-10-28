import { Cancellation, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ComponentOwner } from './component-owner.js';
import { AssetLoader, type AssetBatch } from './asset-loader.js';
import {
  AssetError,
  type AssetContext,
  type AssetEntries,
  type AssetGroup,
  type AssetGroupLease,
  type AssetLoadOptions,
  type ApplicationAssetOptions,
} from './asset-types.js';

export interface AssetContextProvider {
  forOwner(owner: ComponentOwner): AssetContext;
}
interface OwnedRequest {
  readonly group: object;
  phase: 'loading' | 'ready' | 'failed' | 'released';
  release(reason?: unknown): void;
}
interface OwnerState {
  readonly owner: ComponentOwner;
  readonly requests: Set<OwnedRequest>;
  readonly failed: Map<object, Set<OwnedRequest>>;
  off: Cleanup | undefined;
  closed: boolean;
}

/** Application-owned pool; each public facade retains against its explicit owner. */
export class AssetService implements AssetContextProvider {
  private readonly loader: AssetLoader;
  private readonly owners = new WeakMap<ComponentOwner, OwnerState>();
  private readonly contexts = new WeakMap<ComponentOwner, AssetContext>();
  private readonly states = new Set<OwnerState>();
  private closed = false;
  constructor(options: ApplicationAssetOptions, onError: (error: unknown) => void) {
    const transport = options.transport();
    if (!transport || typeof transport.load !== 'function') {
      if (transport && typeof (transport as unknown as PromiseLike<unknown>).then === 'function')
        void Promise.resolve(transport).catch(() => {});
      throw new Error('assets.transport must synchronously return an AssetTransport');
    }
    if (transport.release !== undefined && typeof transport.release !== 'function')
      throw new Error('AssetTransport.release must be a function');
    this.loader = new AssetLoader(transport, {
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      onReleaseError: onError,
    });
  }
  forOwner(owner: ComponentOwner): AssetContext {
    owner.assertOpen();
    let context = this.contexts.get(owner);
    if (!context) {
      context = Object.freeze({
        load: <E extends AssetEntries>(group: AssetGroup<E>, options?: AssetLoadOptions) =>
          this.load(owner, group, options),
      });
      this.contexts.set(owner, context);
    }
    return context;
  }
  private state(owner: ComponentOwner): OwnerState {
    owner.assertOpen();
    owner.cancellation.throwIfAborted();
    if (this.closed) throw new Error('Asset service is disposed');
    let state = this.owners.get(owner);
    if (!state) {
      state = { owner, requests: new Set(), failed: new Map(), off: undefined, closed: false };
      this.owners.set(owner, state);
      this.states.add(state);
      const current = state;
      state.off = owner.cancellation.subscribe(() => this.closeOwner(current));
    }
    if (state.closed) throw new Error('Asset owner is disposed');
    return state;
  }
  private closeOwner(state: OwnerState): void {
    if (state.closed) return;
    state.closed = true;
    state.off?.();
    state.off = undefined;
    this.states.delete(state);
    const errors: unknown[] = [];
    for (const request of [...state.requests]) {
      try {
        request.release(state.owner.cancellation.reason);
      } catch (error) {
        errors.push(error);
      }
    }
    state.failed.clear();
    if (errors.length) throw new AggregateError(errors, 'Asset owner cleanup failed');
  }
  private async load<E extends AssetEntries>(
    owner: ComponentOwner,
    group: AssetGroup<E>,
    options: AssetLoadOptions = {},
  ): Promise<AssetGroupLease<E>> {
    let state: OwnerState;
    try {
      state = this.state(owner);
    } catch (error) {
      throw new AssetError(group.name, '<group>', '', 'load', error);
    }
    const previous = [...(state.failed.get(group) ?? [])];
    const signal = new Cancellation();
    let batch: AssetBatch<E> | undefined, off: Cleanup | undefined;
    const request: OwnedRequest = {
      group,
      phase: 'loading',
      release(reason) {
        if (request.phase === 'released') return;
        request.phase = 'released';
        state.requests.delete(request);
        const failed = state.failed.get(group);
        failed?.delete(request);
        if (failed?.size === 0) state.failed.delete(group);
        off?.();
        off = undefined;
        const errors: unknown[] = [];
        try {
          signal.cancel(reason ?? new Error('Asset owner/lease released'));
        } catch (error) {
          errors.push(error);
        }
        try {
          batch?.release();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, 'Owned asset release failed');
      },
    };
    state.requests.add(request);
    const invalid = () =>
      request.phase === 'released' || state.closed || this.closed || owner.disposed;
    try {
      off = options.signal?.subscribe(() => request.release(options.signal?.reason));
      if (invalid())
        throw new AssetError(group.name, '<group>', '', 'cancel', options.signal?.reason);
      batch = this.loader.start(group, {
        signal,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      });
      if (invalid()) batch.release();
      else for (const old of previous) old.release();
      const lease = await batch.ready;
      if (invalid()) {
        batch.release();
        throw new AssetError(
          group.name,
          '<group>',
          '',
          'cancel',
          new Error('Asset owner exited before delivery'),
        );
      }
      request.phase = 'ready';
      return Object.freeze({ get: lease.get, release: () => request.release() });
    } catch (error) {
      if (invalid() || (error instanceof AssetError && error.operation === 'cancel'))
        request.release();
      else if (batch) {
        request.phase = 'failed';
        const failures = state.failed.get(group) ?? new Set<OwnedRequest>();
        failures.add(request);
        state.failed.set(group, failures);
      } else request.release();
      throw error instanceof AssetError
        ? error
        : new AssetError(group.name, '<group>', '', 'load', error);
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const state of [...this.states]) {
      try {
        this.closeOwner(state);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.loader.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Asset service cleanup failed');
  }
}
