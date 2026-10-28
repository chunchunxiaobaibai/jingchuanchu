import {
  COMPONENT,
  FIELD,
  type InputDefinition,
  type ModelDefinition,
  type OutputDefinition,
  type InputMap,
  type ModelMap,
  type OutputMap,
  type ComponentOptions,
  type ComponentDefinition,
  type PageDefinition,
} from './component-types.js';

type Default<T> = { default: () => T } | (T extends object ? never : { default: T });
type RequiredField = { required: true };
type InputMode = { mode?: 'value' | 'reference' };

function descriptor(
  kind: 'input' | 'model',
  options?: (RequiredField | { default: unknown }) & InputMode,
) {
  const mode = options?.mode ?? 'value';
  if (!['value', 'reference'].includes(mode)) throw new Error('Unknown input mode');
  const required = !!options && 'required' in options && options.required;
  const value = options && 'default' in options ? options.default : undefined;
  if (value !== null && typeof value === 'object')
    throw new Error(`${kind}: object defaults require a factory`);
  return Object.freeze({
    [FIELD]: kind,
    required,
    mode,
    createDefault: () => (typeof value === 'function' ? value() : value),
  });
}

export function input<T>(
  options: RequiredField & InputMode,
): InputDefinition<T> & { readonly required: true };
export function input<T>(
  options: Default<T> & InputMode,
): InputDefinition<T> & { readonly required: false };
export function input<T = undefined>(): InputDefinition<T | undefined> & {
  readonly required: false;
};
export function input(
  options?: (RequiredField | { default: unknown }) & InputMode,
): InputDefinition<unknown> {
  return descriptor('input', options) as InputDefinition<unknown>;
}

export function model<T>(options: RequiredField): ModelDefinition<T> & { readonly required: true };
export function model<T>(options: Default<T>): ModelDefinition<T> & { readonly required: false };
export function model<T = undefined>(): ModelDefinition<T | undefined> & {
  readonly required: false;
};
export function model(options?: RequiredField | { default: unknown }): ModelDefinition<unknown> {
  return descriptor('model', options) as ModelDefinition<unknown>;
}

export function output(): OutputDefinition<void>;
export function output<T>(): OutputDefinition<T>;
export function output(): OutputDefinition<unknown> {
  return Object.freeze({ [FIELD]: 'output' as const });
}

export function templateName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function validateFields(
  fields: InputMap | ModelMap | OutputMap | undefined,
  kind: 'input' | 'model' | 'output',
  names = new Set<string>(),
): Set<string> {
  for (const [name, definition] of Object.entries(fields ?? {})) {
    if (!definition || definition[FIELD] !== kind)
      throw new Error(`Invalid ${kind} declaration: ${name}`);
    const normalized = templateName(name);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(normalized))
      throw new Error(`Invalid ${kind} name: ${name}`);
    if (names.has(normalized)) throw new Error(`Conflicting ${kind} template name: ${normalized}`);
    names.add(normalized);
  }
  return names;
}

function define<I extends InputMap, O extends OutputMap, M extends ModelMap, X extends object>(
  kind: 'component' | 'page',
  options: ComponentOptions<I, O, M, X>,
) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(options.selector))
    throw new Error('Component selector must be a lowercase custom-element tag');
  validateFields(options.models, 'model', validateFields(options.inputs, 'input'));
  validateFields(options.outputs, 'output');
  const selectors = new Set<string>();
  for (const child of options.components ?? []) {
    if (child[COMPONENT] !== true) throw new Error(`Invalid child definition: ${child.selector}`);
    if (selectors.has(child.selector))
      throw new Error(`Duplicate child selector: ${child.selector}`);
    selectors.add(child.selector);
  }
  return Object.freeze({
    ...options,
    [COMPONENT]: true as const,
    kind,
    ...(options.inputs ? { inputs: Object.freeze({ ...options.inputs }) } : {}),
    ...(options.outputs ? { outputs: Object.freeze({ ...options.outputs }) } : {}),
    ...(options.models ? { models: Object.freeze({ ...options.models }) } : {}),
    ...(options.components ? { components: Object.freeze([...options.components]) } : {}),
  });
}

export function defineComponent<
  const I extends InputMap = {},
  const O extends OutputMap = {},
  const M extends ModelMap = {},
  X extends object = {},
  const S extends string = string,
>(
  options: ComponentOptions<I, O, M, X> & { selector: S },
): ComponentDefinition<I, O, M, X> & { readonly selector: S } {
  return define('component', options) as ComponentDefinition<I, O, M, X> & { readonly selector: S };
}
export function definePage<
  const I extends InputMap = {},
  const O extends OutputMap = {},
  const M extends ModelMap = {},
  X extends object = {},
  const S extends string = string,
>(
  options: ComponentOptions<I, O, M, X> & { selector: S },
): PageDefinition<I, O, M, X> & { readonly selector: S } {
  return define('page', options) as PageDefinition<I, O, M, X> & { readonly selector: S };
}
