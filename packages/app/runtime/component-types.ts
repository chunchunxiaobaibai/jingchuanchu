import type { CancellationSignal, Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { ReadonlyData } from '../state.js';
import type { ReadSignal, WritableSignal } from './reactivity.js';
import type { TemplateBinding } from './template.js';
import type { Router } from './router/router.js';
import type { RouteDefinition, RouteLocation } from './router/types.js';
import type { AudioControls } from './application-audio.js';
import type { AssetContext } from './asset-types.js';
import type { ThemeTokens, ThemeAssets, ThemeDefinition, ThemeContext } from './theme-types.js';

export const FIELD = Symbol('application component field');
export const COMPONENT = Symbol('application component');

export interface InputDefinition<T> {
  readonly [FIELD]: 'input';
  readonly mode?: 'value' | 'reference';
  readonly required: boolean;
  readonly createDefault: () => T;
}
export interface ModelDefinition<T> {
  readonly [FIELD]: 'model';
  readonly required: boolean;
  readonly createDefault: () => T;
}
export interface OutputDefinition<T> {
  readonly [FIELD]: 'output';
  readonly payload?: T;
}
export type InputMap = Readonly<Record<string, InputDefinition<unknown>>>;
export type ModelMap = Readonly<Record<string, ModelDefinition<unknown>>>;
export type OutputMap = Readonly<Record<string, OutputDefinition<unknown>>>;
export type FieldValue<D> = D extends InputDefinition<infer T> | ModelDefinition<infer T>
  ? T
  : never;
export type InputValues<I extends InputMap, M extends ModelMap = {}> = {
  readonly [K in keyof I | keyof M]: K extends keyof I
    ? FieldValue<I[K]>
    : K extends keyof M
      ? FieldValue<M[K]>
      : never;
};
export type OutputValue<D> = D extends OutputDefinition<infer T> ? T : never;
export type Inputs<I extends InputMap> = { readonly [K in keyof I]: ReadSignal<FieldValue<I[K]>> };
export type Models<M extends ModelMap> = {
  readonly [K in keyof M]: WritableSignal<FieldValue<M[K]>>;
};

export interface ComponentReference {
  readonly [COMPONENT]: true;
  readonly kind: 'component' | 'page';
  readonly selector: string;
}

export interface ComponentContext<I extends InputMap, O extends OutputMap, M extends ModelMap> {
  readonly inputs: Inputs<I>;
  readonly models: Models<M>;
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  readonly router: Router<readonly RouteDefinition[]>;
  readonly route: ReadSignal<RouteLocation | null>;
  readonly assets: AssetContext;
  readonly audio: AudioControls;
  useTheme<T extends ThemeTokens, A extends ThemeAssets>(
    contract: ThemeDefinition<T, A>,
  ): ThemeContext<T, A>;
  own(cleanup: Cleanup): Cleanup;
  emit<K extends keyof O>(
    name: K,
    ...payload: [OutputValue<O[K]>] extends [void]
      ? [payload?: OutputValue<O[K]>]
      : [payload: OutputValue<O[K]>]
  ): void;
  element<T extends Element = HTMLElement>(ref: string): T;
  on(ref: string, event: string, listener: (event: Event) => void): void;
  useService<T>(definition: Token<T>): T;
  useStore<T>(definition: Token<T>): T;
}

export type ComponentHookContext<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
> = ComponentContext<I, O, M> & { readonly exposed: X };
export type ComponentHook<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
> = (context: ComponentHookContext<I, O, M, X>) => void;

export interface ComponentOptions<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
> {
  readonly selector: string;
  readonly inputs?: I;
  readonly outputs?: O;
  readonly models?: M;
  readonly components?: readonly ComponentReference[];
  readonly templateUrl?: string;
  readonly styleUrl?: string;
  readonly setup?: (context: ComponentContext<I, O, M>) => X;
  readonly onInit?: ComponentHook<I, O, M, X>;
  readonly onMount?: ComponentHook<I, O, M, X>;
  readonly onInputsChanged?: (
    context: ComponentHookContext<I, O, M, X>,
    change: { previous: ReadonlyData<InputValues<I, M>>; current: ReadonlyData<InputValues<I, M>> },
  ) => void;
  readonly onBeforeUpdate?: ComponentHook<I, O, M, X>;
  readonly onUpdated?: ComponentHook<I, O, M, X>;
  readonly onActivate?: ComponentHook<I, O, M, X>;
  readonly onDeactivate?: ComponentHook<I, O, M, X>;
  readonly onDestroy?: ComponentHook<I, O, M, X>;
  /** Resources injected by the component compiler. */
  readonly $template?: string;
  readonly $style?: string;
  readonly $scope?: string;
  readonly $source?: string;
  readonly $bindings?: readonly TemplateBinding[];
}

export interface ComponentDefinition<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
>
  extends ComponentOptions<I, O, M, X>, ComponentReference {
  readonly kind: 'component';
}
export interface PageDefinition<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
>
  extends ComponentOptions<I, O, M, X>, ComponentReference {
  readonly kind: 'page';
}
