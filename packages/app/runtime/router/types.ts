import type { CancellationSignal, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ComponentReference } from '../component-types.js';
export type RoutePage = ComponentReference & { readonly kind: 'page' };
export type RouteQuery = Readonly<Record<string, string | readonly string[]>>;
export type RouteQueryInput = Readonly<
  Record<
    string,
    string | number | boolean | null | undefined | readonly (string | number | boolean)[]
  >
>;
export interface NamedRouteTarget {
  readonly name: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: RouteQueryInput;
  readonly hash?: string;
}
export interface RouteMatch {
  readonly name: string | undefined;
  readonly path: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly redirect?: string | NamedRouteTarget;
}
export interface RouteLocation {
  readonly name: string | undefined;
  readonly path: string;
  readonly fullPath: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly matched: readonly RouteMatch[];
  readonly meta: Readonly<Record<string, unknown>>;
}
export interface NavigationContext {
  readonly from: RouteLocation | null;
  readonly to: RouteLocation;
  readonly params: RouteLocation['params'];
  readonly query: RouteQuery;
  readonly hash: string;
  readonly signal: CancellationSignal;
}
export type GuardResult =
  | { readonly status: 'allow' }
  | { readonly status: 'deny'; readonly reason?: unknown }
  | { readonly status: 'redirect'; readonly target: RouteTarget };
export type RouteGuard = (context: NavigationContext) => GuardResult | PromiseLike<GuardResult>;
interface RouteBase {
  readonly name?: string;
  readonly path: string;
  readonly children?: readonly RouteDefinition[];
  readonly guards?: readonly RouteGuard[];
  readonly beforeLeave?: RouteGuard;
  readonly prepare?: (
    context: NavigationContext,
  ) => Readonly<Record<string, unknown>> | PromiseLike<Readonly<Record<string, unknown>>>;
  readonly preload?: 'none' | 'intent' | 'idle';
  readonly meta?: Readonly<Record<string, unknown>>;
}
export type RouteDefinition = RouteBase &
  (
    | { readonly page: RoutePage; readonly loadPage?: never; readonly redirect?: never }
    | {
        readonly page?: never;
        readonly loadPage: () => PromiseLike<RoutePage>;
        readonly redirect?: never;
      }
    | {
        readonly page?: never;
        readonly loadPage?: never;
        readonly redirect: string | NamedRouteTarget;
      }
  );
type Join<P extends string, C extends string> = P extends ''
  ? C
  : C extends ''
    ? P
    : P extends '/'
      ? `/${C}`
      : `${P}/${C}`;
type SegmentParameter<S extends string> = S extends `:${infer P}` | `*${infer P}` ? P : never;
type Parameters<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? SegmentParameter<Head> | Parameters<Tail>
  : SegmentParameter<P>;
type NamedTarget<N extends string, P extends string> = {
  readonly name: N;
  readonly query?: RouteQueryInput;
  readonly hash?: string;
} & ([Parameters<P>] extends [never]
  ? { readonly params?: Readonly<Record<string, never>> }
  : { readonly params: Readonly<Record<Parameters<P>, string | number>> });
type TargetFor<D, Parent extends string> = D extends { readonly path: infer P extends string }
  ? | (D extends { readonly name: infer N extends string }
        ? NamedTarget<N, Join<Parent, P>>
        : never)
    | (D extends { readonly children: infer C extends readonly RouteDefinition[] }
        ? Targets<C, Join<Parent, P>>
        : never)
  : never;
type Targets<R extends readonly RouteDefinition[], Parent extends string = ''> = TargetFor<
  R[number],
  Parent
>;
export type RouteTarget<R extends readonly RouteDefinition[] = readonly RouteDefinition[]> =
  string | (string extends R[number]['path'] ? NamedRouteTarget : Targets<R>);
export interface RouteMatcher<R extends readonly RouteDefinition[]> {
  match(path: string): RouteLocation | null;
  resolve(target: RouteTarget<R>): RouteLocation;
}
export interface HistoryEntry {
  readonly fullPath: string;
  readonly position: number;
}
export interface HistoryDriver {
  createHref?(fullPath: string): string;
  read(): HistoryEntry;
  push(path: string): HistoryEntry;
  replace(path: string): HistoryEntry;
  go(delta: number): Promise<HistoryEntry | null>;
  restore(entry: HistoryEntry): Promise<void>;
  listen(listener: (entry: HistoryEntry) => void): Cleanup;
  dispose(): void;
}
export class RouteError extends Error {
  readonly module = 'page-router';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Route ${source}: ${operation} failed${cause instanceof Error ? `: ${cause.message}` : ''}`,
      { cause },
    );
    this.name = 'RouteError';
  }
}

export interface RouteDiagnostic {
  readonly module: 'page-router';
  readonly source: string;
  readonly operation: string;
  readonly message: string;
}
export interface NavigationPending {
  readonly id: number;
  readonly to: RouteLocation;
}
export type NavigationResult =
  | { readonly status: 'committed'; readonly to: RouteLocation }
  | {
      readonly status: 'redirected';
      readonly to: RouteLocation;
      readonly redirects: readonly string[];
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'denied'; readonly to: RouteLocation; readonly reason?: unknown }
  | { readonly status: 'failed'; readonly error: RouteError };
export type RoutePreloadResult =
  | { readonly status: 'loaded'; readonly to: RouteLocation }
  | { readonly status: 'skipped'; readonly reason: 'redirect' | 'policy' | 'protected' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: RouteError };
export interface RoutePreloadOptions {
  readonly trigger?: 'intent' | 'idle';
}
export interface PreparedRoutePage {
  readonly record: RouteDefinition;
  readonly page: RoutePage;
  readonly inputs: Readonly<Record<string, unknown>>;
}
export interface RouteRenderContext extends NavigationContext {
  readonly views: readonly PreparedRoutePage[];
  readonly reuseDepth: number;
}
export interface RouteCandidate {
  commit(): Cleanup;
  dispose(): void;
}
export interface RouteRenderer {
  create(context: RouteRenderContext): RouteCandidate | PromiseLike<RouteCandidate>;
}
