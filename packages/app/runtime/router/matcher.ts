import { COMPONENT } from '../component-types.js';
import { snapshot } from '../../state.js';
import {
  RouteError,
  type RouteDefinition,
  type RouteTarget,
  type RouteMatcher,
  type RouteLocation,
  type RouteQuery,
  type RouteQueryInput,
  type NamedRouteTarget,
} from './types.js';
type Segment = { kind: 'static' | 'param' | 'catch'; value: string };
interface RecordEntry {
  route: RouteDefinition;
  segments: Segment[];
  chain: readonly RouteDefinition[];
}
const matchedDefinitions = new WeakMap<RouteLocation, readonly RouteDefinition[]>();
/** Internal metadata stays outside serializable route display state. */
export function getRouteRecords(location: RouteLocation): readonly RouteDefinition[] {
  const records = matchedDefinitions.get(location);
  if (!records)
    throw new RouteError(
      'target',
      'records',
      new Error('Route location was not resolved by the matcher'),
    );
  return records;
}
const fail = (source: string, message: string): never => {
  throw new RouteError(source, 'define', new Error(message));
};
function decode(value: string): string {
  return decodeURIComponent(value);
}
function pathValue(value: string): string {
  if (value === '.' || value === '..' || /[\\\u0000-\u001f\u007f]/.test(value))
    throw new Error('Unsafe path segment');
  return value;
}
function queryString(query: RouteQueryInput): string {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!['string', 'number', 'boolean'].includes(typeof item))
        throw new Error('Query values must be strings, numbers or booleans');
      output.append(key, String(item));
    }
  }
  const result = output.toString();
  return result ? '?' + result : '';
}
/** Strictly decode application URLs without URL() silently resolving dot segments or external origins. */
export function parseRoutePath(input: string): {
  path: string;
  fullPath: string;
  segments: readonly string[];
  query: RouteQuery;
  hash: string;
} {
  try {
    if (
      typeof input !== 'string' ||
      !input.startsWith('/') ||
      input.startsWith('//') ||
      /[\\\u0000-\u001f\u007f]/.test(input)
    )
      throw new Error('Expected an internal absolute path');
    const hashIndex = input.indexOf('#'),
      beforeHash = hashIndex < 0 ? input : input.slice(0, hashIndex),
      rawHash = hashIndex < 0 ? '' : input.slice(hashIndex + 1),
      queryIndex = beforeHash.indexOf('?'),
      rawPath = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex),
      rawQuery = queryIndex < 0 ? '' : beforeHash.slice(queryIndex + 1);
    const trimmed = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    if (rawPath.includes('//')) throw new Error('Empty path segments are unsupported');
    const segments =
      trimmed === '/'
        ? []
        : trimmed
            .slice(1)
            .split('/')
            .map((part) => pathValue(decode(part)));
    const path = '/' + segments.map((part) => encodeURIComponent(part)).join('/');
    const values: Record<string, string | readonly string[]> = Object.create(null);
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue;
      const equal = pair.indexOf('='),
        key = decode((equal < 0 ? pair : pair.slice(0, equal)).replaceAll('+', ' ')),
        value = decode((equal < 0 ? '' : pair.slice(equal + 1)).replaceAll('+', ' ')),
        previous = values[key];
      values[key] =
        previous === undefined
          ? value
          : typeof previous === 'string'
            ? [previous, value]
            : [...previous, value];
    }
    const hash = rawHash ? '#' + decode(rawHash) : '';
    return {
      path,
      fullPath: path + queryString(values) + (hash ? '#' + encodeURIComponent(hash.slice(1)) : ''),
      segments: Object.freeze(segments),
      query: snapshot(values),
      hash,
    };
  } catch (error) {
    throw new RouteError('target', 'parse', error);
  }
}
function compile<R extends readonly RouteDefinition[]>(routes: R) {
  const records: RecordEntry[] = [],
    names = new Set<string>(),
    patterns = new Map<string, RecordEntry>();
  function visit(
    input: readonly RouteDefinition[],
    parent: Segment[],
    chain: readonly RouteDefinition[],
    ancestors: readonly RouteDefinition[] = [],
  ): readonly RouteDefinition[] {
    if (!Array.isArray(input)) fail('routes', 'Routes and children must be arrays');
    return Object.freeze(
      input.map((route) => {
        const source = route.name ?? route.path ?? 'routes';
        if (ancestors.includes(route)) fail(source, 'Circular route children');
        if (route.name !== undefined) {
          if (typeof route.name !== 'string' || !route.name.trim())
            fail('routes', 'Route name is empty');
          if (names.has(route.name)) fail(source, 'Duplicate route name');
          names.add(route.name);
        }
        if (typeof route.path !== 'string' || /[?#\\\u0000-\u001f\u007f]/.test(route.path))
          fail(source, 'Invalid route pattern');
        if (chain.length ? route.path.startsWith('/') : !route.path.startsWith('/'))
          fail(source, 'Root paths must be absolute and child paths must be relative');
        const raw = route.path.replace(/^\//, '').replace(/\/$/, '');
        if (route.path.includes('//')) fail(source, 'Empty path segments are unsupported');
        const segments = [
          ...parent,
          ...(raw
            ? raw.split('/').map((part): Segment => {
                if (part.startsWith(':') || part.startsWith('*')) {
                  const value = part.slice(1);
                  if (!/^[a-zA-Z_$][\w$]*$/.test(value)) fail(source, 'Invalid parameter name');
                  return { kind: part[0] === '*' ? 'catch' : 'param', value };
                }
                try {
                  return { kind: 'static', value: pathValue(decode(part)) };
                } catch (error) {
                  throw new RouteError(source, 'define', error);
                }
              })
            : []),
        ];
        const parameters = new Set<string>();
        segments.forEach((segment, i) => {
          if (segment.kind !== 'static') {
            if (parameters.has(segment.value)) fail(source, 'Duplicate inherited parameter name');
            parameters.add(segment.value);
          }
          if (segment.kind === 'catch' && i !== segments.length - 1)
            fail(source, 'catchAll must be the final segment');
        });
        const choices =
          Number(route.page !== undefined) +
          Number(route.loadPage !== undefined) +
          Number(route.redirect !== undefined);
        if (choices !== 1) fail(source, 'Choose exactly one page, loadPage or redirect');
        if (route.page && (route.page[COMPONENT] !== true || route.page.kind !== 'page'))
          fail(source, 'Routes require definePage(...)');
        if (route.loadPage !== undefined && typeof route.loadPage !== 'function')
          fail(source, 'loadPage must be a function');
        if (route.preload !== undefined && !['none', 'intent', 'idle'].includes(route.preload))
          fail(source, 'Unknown preload strategy');
        if (
          route.guards !== undefined &&
          (!Array.isArray(route.guards) ||
            route.guards.some((guard) => typeof guard !== 'function'))
        )
          fail(source, 'guards must be functions');
        for (const key of ['beforeLeave', 'prepare'] as const)
          if (route[key] !== undefined && typeof route[key] !== 'function')
            fail(source, `${key} must be a function`);
        if (typeof route.redirect === 'string') parseRoutePath(route.redirect);
        const copy = {
          ...route,
          ...(route.meta ? { meta: snapshot(route.meta) } : {}),
          ...(route.guards ? { guards: Object.freeze([...route.guards]) } : {}),
          ...(route.redirect && typeof route.redirect === 'object'
            ? { redirect: snapshot(route.redirect) }
            : {}),
        } as RouteDefinition;
        const nextChain = Object.freeze([...chain, copy]),
          record = { route: copy, segments, chain: nextChain },
          pattern = JSON.stringify(
            segments.map((segment) =>
              segment.kind === 'static' ? ['s', segment.value] : [segment.kind],
            ),
          );
        const previous = patterns.get(pattern);
        if (previous && !chain.includes(previous.route))
          fail(source, 'Conflicting route match pattern');
        patterns.set(pattern, record);
        records.push(record);
        if (route.children)
          Object.assign(copy, {
            children: visit(route.children, segments, nextChain, [...ancestors, route]),
          });
        return Object.freeze(copy);
      }),
    );
  }
  try {
    const normalized = visit(routes, [], []) as unknown as R;
    const score = (segment: Segment | undefined) =>
      !segment ? 4 : segment.kind === 'static' ? 3 : segment.kind === 'param' ? 2 : 1;
    records.sort((a, b) => {
      for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
        const difference = score(b.segments[i]) - score(a.segments[i]);
        if (difference) return difference;
      }
      return b.chain.length - a.chain.length;
    });
    return { routes: normalized, records };
  } catch (error) {
    throw error instanceof RouteError ? error : new RouteError('routes', 'define', error);
  }
}
export function defineRoutes<const R extends readonly RouteDefinition[]>(routes: R): R {
  return compile(routes).routes;
}
export function createRouteMatcher<const R extends readonly RouteDefinition[]>(
  routes: R,
): RouteMatcher<R> {
  const { records } = compile(routes);
  function match(path: string): RouteLocation | null {
    const location = parseRoutePath(path);
    for (const record of records) {
      const params: Record<string, string> = Object.create(null);
      let index = 0,
        matched = true;
      for (const segment of record.segments) {
        if (segment.kind === 'catch') {
          params[segment.value] = location.segments.slice(index).join('/');
          index = location.segments.length;
          break;
        }
        const value = location.segments[index++];
        if (value === undefined || (segment.kind === 'static' && value !== segment.value)) {
          matched = false;
          break;
        }
        if (segment.kind === 'param') params[segment.value] = value;
      }
      if (!matched || index !== location.segments.length) continue;
      const meta = Object.assign(
        Object.create(null),
        ...record.chain.map((item) => item.meta ?? {}),
      ) as Record<string, unknown>;
      const result = Object.freeze({
        name: record.route.name,
        path: location.path,
        fullPath: location.fullPath,
        params: Object.freeze(params),
        query: location.query,
        hash: location.hash,
        matched: Object.freeze(
          record.chain.map((route) =>
            Object.freeze({
              name: route.name,
              path: route.path,
              meta: route.meta ?? Object.freeze({}),
              ...(route.redirect ? { redirect: route.redirect } : {}),
            }),
          ),
        ),
        meta: Object.freeze(meta),
      });
      matchedDefinitions.set(result, record.chain);
      return result;
    }
    return null;
  }
  function resolve(target: RouteTarget<R>): RouteLocation {
    if (typeof target === 'string') {
      const location = match(target);
      if (!location)
        throw new RouteError('target', 'resolve', new Error('No route matches the path'));
      return location;
    }
    try {
      if (!target || typeof target.name !== 'string')
        throw new Error('Named target requires a name');
      const record = records.find((item) => item.route.name === target.name);
      if (!record) throw new Error(`Unknown route name: ${target.name}`);
      const parameters = (target as NamedRouteTarget).params ?? {},
        required = record.segments.filter((segment) => segment.kind !== 'static');
      for (const key of Object.keys(parameters))
        if (!required.some((segment) => segment.value === key))
          throw new Error(`Unknown parameter: ${key}`);
      const parts = record.segments.flatMap((segment) => {
        if (segment.kind === 'static') return [encodeURIComponent(segment.value)];
        const value = parameters[segment.value];
        if (typeof value !== 'string' && typeof value !== 'number')
          throw new Error(`Missing parameter: ${segment.value}`);
        const text = String(value);
        if (!text && segment.kind === 'param') throw new Error(`Empty parameter: ${segment.value}`);
        const components = segment.kind === 'catch' ? (text ? text.split('/') : []) : [text];
        if (components.some((part) => !part)) throw new Error('Empty catchAll segment');
        return components.map((part) => encodeURIComponent(pathValue(part)));
      });
      const hash = target.hash?.replace(/^#/, '') ?? '',
        path =
          '/' +
          parts.join('/') +
          queryString(target.query ?? {}) +
          (hash ? '#' + encodeURIComponent(hash) : '');
      const result = match(path);
      if (!result || !getRouteRecords(result).includes(record.route))
        throw new Error('Named target is shadowed by a higher-priority route');
      return result;
    } catch (error) {
      throw new RouteError('target', 'resolve', error);
    }
  }
  return Object.freeze({ match, resolve });
}
