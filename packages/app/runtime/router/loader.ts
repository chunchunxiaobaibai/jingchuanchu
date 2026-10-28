import { COMPONENT } from '../component-types.js';
import type { RouteDefinition, RoutePage } from './types.js';

type Loader = NonNullable<RouteDefinition['loadPage']>;
function page(value: RoutePage): RoutePage {
  if (!value || value[COMPONENT] !== true || value.kind !== 'page')
    throw new Error('loadPage must resolve a definePage(...) definition');
  return value;
}

/** One Router owns one module cache; no page instances or user data live here. */
export class RouteModuleLoader {
  private readonly entries = new Map<Loader, Promise<RoutePage>>();
  private closed = false;
  load(record: RouteDefinition): RoutePage | Promise<RoutePage> {
    if (this.closed) throw new Error('Route module loader is disposed');
    if (record.page) return page(record.page);
    const loader = record.loadPage;
    if (!loader) return Promise.reject(new Error('Redirect records do not load a page'));
    const existing = this.entries.get(loader);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(() => {
        if (this.closed) throw new Error('Route module loader is disposed');
        return loader();
      })
      .then(page);
    this.entries.set(loader, pending);
    void pending.catch(() => {
      if (this.entries.get(loader) === pending) this.entries.delete(loader);
    });
    return pending;
  }
  dispose(): void {
    this.closed = true;
    this.entries.clear();
  }
}
