import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { getComponentMount } from '../component-runtime.js';
import type { ComponentOwner } from '../component-owner.js';

export interface RouteOutletRegistration {
  readonly host: Element;
  readonly owner: ComponentOwner;
}
const boundaries = new WeakMap<ComponentOwner, Set<RouteOutletRegistration>>();
const elements = new WeakMap<Element, RouteOutletRegistration>();

export function registerRouteOutlet(registration: RouteOutletRegistration): Cleanup {
  registration.owner.assertOpen();
  if (elements.has(registration.host)) throw new Error('Route outlet is already registered');
  let boundary: ComponentOwner | undefined;
  for (let ancestor = registration.owner.parent; ancestor; ancestor = ancestor.parent) {
    const mount = getComponentMount(ancestor.scope);
    if (!mount) continue;
    boundary = ancestor;
    if (mount.kind === 'page') break;
  }
  if (!boundary) throw new Error('RouterOutlet requires a parent page or application root');
  const entries = boundaries.get(boundary) ?? new Set<RouteOutletRegistration>();
  boundaries.set(boundary, entries);
  entries.add(registration);
  elements.set(registration.host, registration);
  return () => {
    entries.delete(registration);
    elements.delete(registration.host);
  };
}

export function resolveRouteOutlet(boundary: ComponentOwner): RouteOutletRegistration {
  boundary.assertOpen();
  const mount = getComponentMount(boundary.scope);
  const matches = [...(boundaries.get(boundary) ?? [])].filter(
    (entry) => !entry.owner.disposed && mount?.host.contains(entry.host),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one registered router-outlet in page/root, found ${matches.length}`);
  return matches[0]!;
}

export function getRouteOutlet(host: Element): RouteOutletRegistration | undefined {
  return elements.get(host);
}
