import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { snapshot, type ReadonlyData } from '../state.js';
import {
  COMPONENT,
  type ComponentDefinition,
  type PageDefinition,
  type ComponentReference,
  type ComponentOptions,
  type ComponentHookContext,
  type InputMap,
  type OutputMap,
  type ModelMap,
  type InputValues,
  type FieldValue,
  type OutputValue,
} from './component-types.js';
import { ComponentOwner } from './component-owner.js';
import { ROUTER_CONTEXT, ROUTE_CONTEXT, ASSETS_CONTEXT, THEME_CONTEXT } from './context-keys.js';
import { AUDIO_CONTEXT } from './context-keys.js';
import type { AudioContextProvider } from './audio-context.js';
import type { AssetContextProvider } from './asset-service.js';
import type { ThemeContextProvider } from './theme-service.js';
import { templateName } from './component.js';
import {
  signal,
  referenceSignal,
  effect,
  SIGNAL,
  runUntracked,
  captureSignal,
  type WritableSignal,
  type ReadSignal,
} from './reactivity.js';
import { batch, queueReactiveJob, cancelReactiveJob, type ReactiveJob } from './scheduler.js';
import { reportApplicationError } from './errors.js';
import {
  bindTemplate,
  type TemplateFragment,
  type TemplateBranch,
  type TemplateProjection,
} from './template.js';

export class ComponentError extends Error {
  readonly module = 'component-model';
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Component ${source}: ${operation} failed${cause instanceof Error ? ': ' + cause.message : ''}`,
      { cause },
    );
    this.name = 'ComponentError';
  }
}

export interface ComponentMountOptions<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
> {
  owner?: ComponentOwner;
  inputs?: Partial<InputValues<I, M>>;
  outputs?: { readonly [K in keyof O]?: (payload: OutputValue<O[K]>) => void };
  models?: { readonly [K in keyof M]?: WritableSignal<FieldValue<M[K]>> };
  onError?: (error: unknown) => void;
}
export interface ComponentInstance<P, X extends object> {
  readonly owner: ComponentOwner;
  readonly exposed: Readonly<X>;
  setInputs(inputs: Partial<P>): void;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}

type RuntimeDefinition = ComponentOptions<InputMap, OutputMap, ModelMap, Record<string, unknown>> &
  ComponentReference;
type RuntimeInstance = ComponentInstance<InputValues<InputMap, ModelMap>, Record<string, unknown>>;
type RuntimeContext = ComponentHookContext<InputMap, OutputMap, ModelMap, Record<string, unknown>>;
const hosts = new WeakSet<Element>();
const mounts = new WeakMap<
  Scope,
  { host: Element; owner: ComponentOwner; kind: 'component' | 'page' }
>();
/** Internal explicit-scope lookup used by framework components; no global current instance. */
export function getComponentMount(scope: Scope) {
  return mounts.get(scope);
}
const renderers = new WeakMap<RuntimeInstance, () => void>();
type InputReplacement = (
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
) => () => Cleanup;
const inputReplacements = new WeakMap<object, InputReplacement>();

/** Internal routing transaction: validation/defaults run before touching a retained page. */
export function stageComponentInputs(
  instance: object,
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): () => Cleanup {
  const stage = inputReplacements.get(instance);
  if (!stage) throw new Error('Expected a mounted component instance');
  return stage(previous, next);
}

/** Type erasure is confined to heterogeneous component dispatch. Definitions retain user-facing types. */
export function mountComponent<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
>(
  host: Element,
  definition: ComponentDefinition<I, O, M, X> | PageDefinition<I, O, M, X>,
  options: ComponentMountOptions<I, O, M> = {},
): ComponentInstance<InputValues<I, M>, X> {
  return mount(
    host,
    definition as unknown as RuntimeDefinition,
    options as unknown as ComponentMountOptions<InputMap, OutputMap, ModelMap>,
  ) as unknown as ComponentInstance<InputValues<I, M>, X>;
}

function mount(
  host: Element,
  definition: RuntimeDefinition,
  options: ComponentMountOptions<InputMap, OutputMap, ModelMap> & {
    slots?: Readonly<Record<string, TemplateProjection>>;
  },
): RuntimeInstance {
  if (hosts.has(host)) throw new Error('Component host is already mounted');
  if (definition[COMPONENT] !== true) throw new Error('Expected a component definition');
  const owner = new ComponentOwner(options.owner);
  const source = definition.$source ?? definition.selector;
  const original = [...host.childNodes];
  const inputCells: Record<string, WritableSignal<unknown>> = Object.create(null);
  const modelCells: Record<string, WritableSignal<unknown>> = Object.create(null);
  const inputs: Record<string, ReadSignal<unknown>> = Object.create(null);
  const models: Record<string, WritableSignal<unknown>> = Object.create(null);
  const children = new Set<RuntimeInstance>();
  let view: ReturnType<typeof bindTemplate> | undefined;
  let nodes: Node[] = [],
    elements: Element[] = [];
  let exposed: Record<string, unknown> = Object.freeze({});
  let mounted = false,
    constructed = false,
    active = true;
  let lastInputs: ReadonlyData<Record<string, unknown>> = {};
  let lastInputRefs: Record<string, unknown> = {};
  const values = (): Record<string, unknown> =>
    Object.fromEntries([
      ...Object.entries(inputCells).map(([name, cell]) => [name, cell()]),
      ...Object.entries(models).map(([name, cell]) => [name, cell()]),
    ]);
  const reference = (name: string): boolean => definition.inputs?.[name]?.mode === 'reference';
  const copyInputs = (refs: Record<string, unknown>): ReadonlyData<Record<string, unknown>> =>
    Object.freeze(
      Object.fromEntries(
        Object.entries(refs).map(([key, value]) => [key, reference(key) ? value : snapshot(value)]),
      ),
    );
  const fail = (error: unknown) => reportApplicationError(error, options.onError);
  function invoke(operation: string, callback?: () => unknown): void {
    if (!callback) return;
    try {
      const result = callback();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) =>
          fail(new ComponentError(source, operation, error)),
        );
        throw new Error('Lifecycle hooks must be synchronous');
      }
    } catch (error) {
      throw new ComponentError(source, operation, error);
    }
  }
  const update: ReactiveJob = {
    label: `${source}:inputs`,
    run() {
      if (!mounted || !active || owner.disposed) return;
      const refs = values();
      if (Object.keys(refs).every((key) => Object.is(lastInputRefs[key], refs[key]))) return;
      const current = copyInputs(refs);
      const previous = lastInputs;
      lastInputs = current;
      lastInputRefs = refs;
      invoke('onInputsChanged', () => definition.onInputsChanged?.(context, { previous, current }));
    },
    onError: fail,
    onCycle(error) {
      try {
        owner.dispose();
      } catch (cleanupError) {
        fail(new AggregateError([error, cleanupError]));
        return;
      }
      fail(error);
    },
  };
  const request = (): void => {
    if (mounted && active && !owner.disposed) queueReactiveJob(update);
  };
  function element<T extends Element = HTMLElement>(ref: string): T {
    if (!mounted) throw new Error('Component nodes are unavailable before onMount');
    const matches = collectElements(host, definition.components ?? []).filter(
      (node) => node.getAttribute('ref') === ref,
    );
    if (matches.length !== 1) throw new Error(`Expected one ref="${ref}", found ${matches.length}`);
    return matches[0] as T;
  }
  const context: RuntimeContext = {
    inputs,
    models,
    scope: owner.scope,
    signal: owner.cancellation,
    get router() {
      return owner.getContext<RuntimeContext['router']>(ROUTER_CONTEXT);
    },
    get route() {
      return owner.getContext<RuntimeContext['route']>(ROUTE_CONTEXT);
    },
    get audio() {
      return owner.getContext<AudioContextProvider>(AUDIO_CONTEXT).forOwner(owner);
    },
    get assets() {
      return owner.getContext<AssetContextProvider>(ASSETS_CONTEXT).forOwner(owner);
    },
    useTheme: (contract) =>
      owner.getContext<ThemeContextProvider>(THEME_CONTEXT).forOwner(owner, contract),
    get exposed() {
      return exposed;
    },
    own: (cleanup: Cleanup) => owner.scope.own(cleanup),
    emit(name, payload) {
      owner.assertOpen();
      if (!Object.hasOwn(definition.outputs ?? {}, name))
        throw new Error(`Unknown component output: ${String(name)}`);
      options.outputs?.[name]?.(payload);
    },
    element,
    on(ref, event, listener) {
      owner.assertOpen();
      const node = element(ref);
      const wrapped = (value: Event): void => {
        if (!active || owner.disposed) return;
        try {
          const result = listener(value) as unknown;
          if (result && typeof (result as PromiseLike<unknown>).then === 'function')
            void Promise.resolve(result).catch((error) =>
              fail(new ComponentError(source, `event:${event}`, error)),
            );
        } catch (error) {
          fail(new ComponentError(source, `event:${event}`, error));
        }
      };
      node.addEventListener(event, wrapped);
      owner.scope.own(() => node.removeEventListener(event, wrapped));
    },
    useService: (token) => owner.resolve('services', token),
    useStore: (token) => owner.resolve('stores', token),
  };
  owner.beforeDispose = () => {
    if (constructed) invoke('onDestroy', () => definition.onDestroy?.(context));
  };
  owner.afterDispose = () => {
    mounts.delete(owner.scope);
    cancelReactiveJob(update);
    for (const node of nodes) if (node.parentNode === host) host.removeChild(node);
    host.append(...original);
    hosts.delete(host);
  };
  const instance: RuntimeInstance = {
    owner,
    get exposed() {
      return exposed;
    },
    setInputs(patch) {
      owner.assertOpen();
      for (const [name, value] of Object.entries(patch)) {
        if (!Object.hasOwn(inputCells, name) && !Object.hasOwn(modelCells, name))
          throw new Error(`Unknown component input: ${name}`);
        if (options.models?.[name])
          throw new Error(`Update bound model ${name} through its parent target`);
        if (!reference(name)) snapshot(value);
      }
      batch(() => {
        for (const [name, value] of Object.entries(patch))
          (inputCells[name] ?? modelCells[name])!.set(value);
      });
      request();
    },
    activate() {
      owner.assertOpen();
      if (active) return;
      active = true;
      owner.setActive(true);
      view?.activate();
      children.forEach((child) => child.activate());
      invoke('onActivate', () => definition.onActivate?.(context));
      request();
    },
    deactivate() {
      owner.assertOpen();
      if (!active) return;
      active = false;
      owner.setActive(false);
      view?.deactivate();
      children.forEach((child) => child.deactivate());
      invoke('onDeactivate', () => definition.onDeactivate?.(context));
    },
    dispose: () => owner.dispose(),
  };
  let preparingView = false;
  const beforeUpdate = (): void => {
    if (!mounted || !active || preparingView) return;
    invoke('onBeforeUpdate', () => definition.onBeforeUpdate?.(context));
    preparingView = true;
  };
  const updated = (): void => {
    if (!preparingView) return;
    preparingView = false;
    invoke('onUpdated', () => definition.onUpdated?.(context));
  };
  const isChild = (node: Element) =>
    (definition.components ?? []).some((child) => child.selector === node.localName);
  function mountChildren(
    elements: Element[],
    binding: ReturnType<typeof bindTemplate>,
    parentOwner: ComponentOwner,
  ): RuntimeInstance[] {
    const local: RuntimeInstance[] = [];
    for (const child of definition.components ?? [])
      for (const node of elements.filter((node) => node.localName === child.selector)) {
        const childDefinition = child as RuntimeDefinition,
          initial: Record<string, unknown> = {};
        for (const key of Object.keys(childDefinition.inputs ?? {}))
          if (node.hasAttribute(templateName(key)))
            initial[key] = node.getAttribute(templateName(key));
        Object.assign(initial, binding.initialInputs.get(node));
        const childInstance = runUntracked(() =>
          mount(node, childDefinition, {
            owner: parentOwner,
            inputs: initial,
            outputs: binding.outputs.get(node) ?? {},
            models: binding.initialModels.get(node) ?? {},
            slots: binding.projections.get(node) ?? {},
            ...(options.onError ? { onError: options.onError } : {}),
          }),
        );
        children.add(childInstance);
        local.push(childInstance);
        childInstance.owner.scope.own(() => children.delete(childInstance));
        binding.connect(node, {
          setInputs(patch) {
            childInstance.setInputs(patch);
            runUntracked(() => renderers.get(childInstance)?.());
          },
        });
      }
    return local;
  }
  function createView(
    program: TemplateFragment,
    lexical: Record<string, unknown>,
    parentOwner: ComponentOwner,
    branchBefore: () => void = beforeUpdate,
  ): TemplateBranch {
    const branchOwner = new ComponentOwner(parentOwner),
      template = host.ownerDocument.createElement('template');
    template.innerHTML = program.html;
    // Template contents belong to an inert document in real browsers. Children
    // mount before insertion, so adopt now to give their DOM adapters the host
    // document/window (Canvas, viewport, input and frame drivers require it).
    const fragment = host.ownerDocument.adoptNode(template.content),
      branchNodes = [...fragment.childNodes];
    branchOwner.afterDispose = () => {
      for (const node of branchNodes) node.parentNode?.removeChild(node);
    };
    try {
      const elements = collectElements(fragment, definition.components ?? []);
      if (definition.$scope) elements.forEach((node) => node.setAttribute(definition.$scope!, ''));
      const binding = bindTemplate(fragment, program.bindings, lexical, branchOwner, {
        isChild,
        onError: fail,
        beforeUpdate: branchBefore,
        updated: () => {},
        subscribe: false,
        createView: (program, lexical, owner, before = branchBefore) =>
          createView(program, lexical, owner, before),
        ...(options.slots ? { slots: options.slots } : {}),
      });
      const localChildren = mountChildren(elements, binding, branchOwner);
      const start = host.ownerDocument.createComment('view:start'),
        end = host.ownerDocument.createComment('view:end');
      fragment.prepend(start);
      fragment.append(end);
      branchNodes.unshift(start);
      branchNodes.push(end);
      return {
        fragment,
        nodes() {
          const nodes: Node[] = [];
          for (let node: Node | null = start; node; node = node.nextSibling) {
            nodes.push(node);
            if (node === end) break;
          }
          return nodes;
        },
        render: binding.render,
        activate() {
          binding.activate();
          localChildren.forEach((child) => {
            if (!child.owner.disposed) child.activate();
          });
        },
        deactivate() {
          binding.deactivate();
          localChildren.forEach((child) => {
            if (!child.owner.disposed) child.deactivate();
          });
        },
        dispose: () => branchOwner.dispose(),
      };
    } catch (error) {
      try {
        branchOwner.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${source}: conditional view failed`);
      }
      throw error;
    }
  }
  try {
    hosts.add(host);
    mounts.set(owner.scope, { host, owner, kind: definition.kind });
    for (const name of Object.keys(options.inputs ?? {}))
      if (
        !Object.hasOwn(definition.inputs ?? {}, name) &&
        !Object.hasOwn(definition.models ?? {}, name)
      )
        throw new Error(`Unknown component input: ${name}`);
    for (const name of Object.keys(options.models ?? {}))
      if (!Object.hasOwn(definition.models ?? {}, name))
        throw new Error(`Unknown component model: ${name}`);
    for (const [name, field] of Object.entries(definition.inputs ?? {})) {
      const present = Object.hasOwn(options.inputs ?? {}, name);
      if (field.required && !present) throw new Error(`Missing required input: ${name}`);
      const cell = (reference(name) ? referenceSignal : signal)(
        present ? options.inputs![name] : field.createDefault(),
      );
      inputCells[name] = cell;
      inputs[name] = Object.defineProperty(() => cell(), SIGNAL, {
        value: true,
      }) as ReadSignal<unknown>;
    }
    for (const [name, field] of Object.entries(definition.models ?? {})) {
      const target = options.models?.[name];
      if (target && (typeof target !== 'function' || typeof target.set !== 'function'))
        throw new Error(`Model ${name} requires a writable target`);
      const present = Object.hasOwn(options.inputs ?? {}, name);
      if (field.required && !present && !target) throw new Error(`Missing required model: ${name}`);
      const cell = signal(
        target ? target() : present ? options.inputs![name] : field.createDefault(),
      );
      modelCells[name] = cell;
      const read = (() => (target ? target() : cell())) as WritableSignal<unknown>;
      Object.defineProperty(read, SIGNAL, { value: true });
      read.set = (value) => {
        owner.assertOpen();
        if (target) target.set(value);
        else cell.set(value);
      };
      read.update = (reduce) => read.set(reduce(read()));
      models[name] = read;
      if (target)
        effect(
          () => {
            target();
            request();
          },
          owner.scope,
          { onError: fail },
        );
    }
    Object.freeze(inputs);
    Object.freeze(models);
    lastInputRefs = values();
    lastInputs = copyInputs(lastInputRefs);
    constructed = true;
    invoke('setup', () => {
      const value = definition.setup ? definition.setup(context) : {};
      if (value && typeof value.then === 'function') return value;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Component setup must return an exposed object');
      exposed = Object.freeze({ ...value });
    });
    invoke('onInit', () => definition.onInit?.(context));
    if (owner.disposed) throw new Error('Component disposed during initialization');
    if (definition.$template === undefined)
      throw new Error('Missing compiled template; configure the component compiler');
    const template = host.ownerDocument.createElement('template');
    template.innerHTML = definition.$template;
    nodes = [...template.content.childNodes];
    host.replaceChildren(template.content);
    elements = collectElements(host, definition.components ?? []);
    if (definition.$scope) elements.forEach((node) => node.setAttribute(definition.$scope!, ''));
    view = bindTemplate(host, definition.$bindings ?? [], exposed, owner, {
      isChild,
      onError: fail,
      beforeUpdate,
      updated,
      createView,
      ...(options.slots ? { slots: options.slots } : {}),
      finished: () => {
        preparingView = false;
      },
    });
    if (definition.$style) {
      const style = host.ownerDocument.createElement('style');
      style.textContent = definition.$style;
      host.prepend(style);
      nodes.unshift(style);
    }
    mountChildren(elements, view, owner);
    mounted = true;
    invoke('onMount', () => definition.onMount?.(context));
    if (owner.disposed) throw new Error('Component disposed during mounting');
    renderers.set(instance, () => {
      update.run();
      view?.render();
    });
    inputReplacements.set(instance, (previous, next) => {
      owner.assertOpen();
      const fields = { ...definition.inputs, ...definition.models };
      for (const [name, field] of Object.entries(fields))
        if (field.required && !Object.hasOwn(next, name) && !options.models?.[name])
          throw new Error(`Missing required input: ${name}`);
      const patch: Record<string, unknown> = Object.create(null);
      for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (!Object.hasOwn(fields, name)) throw new Error(`Unknown component input: ${name}`);
        if (options.models?.[name])
          throw new Error(`Update bound model ${name} through its parent target`);
        patch[name] = Object.hasOwn(next, name) ? next[name] : fields[name]!.createDefault();
      }
      const prepared = copyInputs(patch);
      return () => {
        owner.assertOpen();
        const rollback = Object.keys(prepared).map((name) =>
          captureSignal((inputCells[name] ?? modelCells[name])!),
        );
        instance.setInputs(prepared);
        return () => {
          owner.assertOpen();
          batch(() => rollback.forEach((restore) => restore()));
          request();
        };
      };
    });
    return instance;
  } catch (error) {
    try {
      owner.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Component ${source}: mount failed`);
    }
    throw error instanceof ComponentError ? error : new ComponentError(source, 'mount', error);
  }
}

function collectElements(
  host: Element | DocumentFragment,
  children: readonly ComponentReference[],
): Element[] {
  const selectors = new Set(children.map((child) => child.selector)),
    elements: Element[] = [];
  function visit(node: Element): void {
    elements.push(node);
    if (!selectors.has(node.localName) && !hosts.has(node) && node.localName !== 'slot')
      for (const child of node.children) visit(child);
  }
  for (const child of host.children) visit(child);
  return elements;
}
