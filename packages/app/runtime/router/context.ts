import type { ComponentOwner } from '../component-owner.js';
import { ROUTER_CONTEXT, ROUTE_CONTEXT } from '../context-keys.js';
import { signal, SIGNAL, type ReadSignal } from '../reactivity.js';
import type { RouteDefinition, RouteLocation } from './types.js';
import type { Router } from './router.js';

/** Internal application assembly; no process-global router or current component. */
export function installRouterContext<R extends readonly RouteDefinition[]>(
  owner: ComponentOwner,
  router: Router<R>,
): void {
  owner.provideContext(ROUTER_CONTEXT, router);
  owner.provideContext(ROUTE_CONTEXT, router.current);
}

export function installPageRoute(owner: ComponentOwner, location: RouteLocation) {
  const current = signal<RouteLocation>(location);
  const read = Object.freeze(
    Object.defineProperty(() => current(), SIGNAL, { value: true }),
  ) as ReadSignal<RouteLocation>;
  owner.provideContext(ROUTE_CONTEXT, read);
  return current;
}
