import type { ComponentOwner } from './component-owner.js';
import type { InputDefinition, ModelDefinition, OutputDefinition } from './component-types.js';
import { SIGNAL, signal, effect, type ReadSignal } from './reactivity.js';
import type { ReadonlyData } from '../state.js';
import { bindNativeModel } from './models.js';
import type { WritableSignal } from './reactivity.js';

export type TemplateScope<X> = {
  readonly [K in keyof X]: X[K] extends ReadSignal<infer V> ? ReadonlyData<V> : X[K];
};
export type TemplateField<D> = D extends InputDefinition<infer V> | ModelDefinition<infer V>
  ? V
  : never;
export type TemplateOutput<D> = D extends OutputDefinition<infer V> ? V : never;
export type TemplateClass = string | readonly string[] | Readonly<Record<string, boolean>>;
export interface TemplateFragment {
  readonly html: string;
  readonly bindings: readonly TemplateBinding[];
}
export interface TemplateBranch {
  readonly fragment: DocumentFragment;
  nodes(): readonly Node[];
  render(): void;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}
export interface TemplateProjection {
  mount(owner: ComponentOwner, beforeUpdate: () => void): TemplateBranch;
}
export interface TemplateBinding {
  readonly path: readonly number[];
  readonly kind: 'text' | 'property' | 'event' | 'model' | 'when' | 'each' | 'slot' | 'projection';
  readonly slots?: Readonly<Record<string, TemplateFragment>>;
  readonly item?: string;
  readonly key?: (scope: Record<string, unknown>) => unknown;
  readonly view?: TemplateFragment;
  readonly name?: string;
  readonly source: string;
  readonly evaluate: (scope: Record<string, unknown>, event: unknown) => unknown;
}
interface ChildTarget {
  setInputs(inputs: Record<string, unknown>): void;
}
interface BindingTarget {
  binding: TemplateBinding;
  node: Node;
}

export class TemplateError extends Error {
  readonly module = 'component-model';
  constructor(
    readonly source: string,
    cause: unknown,
  ) {
    super(
      `${source}: Template binding failed${cause instanceof Error ? `: ${cause.message}` : ''}`,
      { cause },
    );
    this.name = 'TemplateError';
  }
}
function scopeFor(exposed: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string' || !Object.hasOwn(exposed, key))
        throw new Error(`Unknown exposed member: ${String(key)}`);
      const value = exposed[key];
      return typeof value === 'function' && SIGNAL in value
        ? (value as ReadSignal<unknown>)()
        : value;
    },
    set() {
      throw new Error('Template scope is read-only');
    },
  });
}
function className(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(' ');
  if (
    value &&
    typeof value === 'object' &&
    Object.values(value).every((v) => typeof v === 'boolean')
  )
    return Object.keys(value)
      .filter((key) => (value as Record<string, boolean>)[key])
      .join(' ');
  throw new Error('Class binding requires a string, string array or boolean map');
}
function setProperty(node: Element, name: string, value: unknown): void {
  if (/^(on|style$|srcdoc$|innerhtml$|outerhtml$|textcontent$|classname$)/i.test(name))
    throw new Error(`Unsafe property binding: ${name}`);
  if (
    /^(href|src|action|formaction|xlink:href)$/i.test(name) &&
    /^(javascript|vbscript):|^data:text\/html/i.test(String(value).replace(/[\u0000-\u0020]/g, ''))
  )
    throw new Error('Unsafe URL binding');
  if (name === 'class') {
    node.setAttribute('class', className(value));
    return;
  }
  if (name.startsWith('aria-') || name.startsWith('data-')) {
    if (value == null) node.removeAttribute(name);
    else node.setAttribute(name, String(value));
    return;
  }
  if (!(name in node)) throw new Error(`Unknown DOM property: ${name}`);
  Reflect.set(node, name, value);
}

/** Binds compiler-generated callbacks to this instance and its owner; no string expression execution. */
export function bindTemplate(
  host: Element | DocumentFragment,
  bindings: readonly TemplateBinding[],
  exposed: Record<string, unknown>,
  owner: ComponentOwner,
  options: {
    isChild: (node: Element) => boolean;
    onError: (error: unknown) => void;
    beforeUpdate: () => void;
    updated: () => void;
    subscribe?: boolean;
    createView: (
      view: TemplateFragment,
      exposed: Record<string, unknown>,
      owner: ComponentOwner,
      beforeUpdate?: () => void,
    ) => TemplateBranch;
    slots?: Readonly<Record<string, TemplateProjection>>;
    finished?: () => void;
  },
) {
  const scope = scopeFor(exposed),
    active = signal(true),
    targets: BindingTarget[] = bindings.map((binding) => {
      let node: Node = host;
      for (const index of binding.path) {
        const next = node.childNodes[index];
        if (!next) throw new Error(`${binding.source}: Invalid compiled node path`);
        node = next;
      }
      return { binding, node };
    });
  const children = new Map<Element, ChildTarget>();
  const projections = new Map<Element, Record<string, TemplateProjection>>();
  for (const target of targets)
    if (target.binding.kind === 'projection') {
      const entries: Record<string, TemplateProjection> = Object.create(null);
      for (const [name, program] of Object.entries(target.binding.slots ?? {}))
        entries[name] = {
          mount: (receiver, before) => options.createView(program, exposed, receiver, before),
        };
      projections.set(target.node as Element, entries);
    }
  for (const target of targets)
    if (target.binding.kind === 'slot') (target.node as Element).replaceChildren();
  const initialModels = new Map<Element, Record<string, WritableSignal<unknown>>>();
  const nativeModels = new Map<BindingTarget, ReturnType<typeof bindNativeModel>>();
  const initialInputs = new Map<Element, Record<string, unknown>>(),
    outputs = new Map<Element, Record<string, (payload: unknown) => void>>();
  const previous = new Map<BindingTarget, unknown>();
  const branches = new Map<BindingTarget, TemplateBranch>();
  const lists = new Map<
    BindingTarget,
    Map<string | number, { branch: TemplateBranch; cell: WritableSignal<unknown>; input: unknown }>
  >();
  const textOriginals = new Map<Node, string>();
  for (const target of targets)
    if (target.binding.kind === 'text')
      textOriginals.set(target.node, target.node.textContent ?? '');
  const evaluate = (target: BindingTarget, event?: unknown): unknown => {
    try {
      return target.binding.evaluate(scope, event);
    } catch (error) {
      throw new TemplateError(target.binding.source, error);
    }
  };
  for (const target of targets)
    if (target.binding.kind === 'model') {
      const node = target.node as Element;
      let model;
      try {
        model = target.binding.evaluate(exposed, undefined) as WritableSignal<unknown>;
      } catch (error) {
        throw new TemplateError(target.binding.source, error);
      }
      if (options.isChild(node)) {
        if (!initialModels.has(node)) initialModels.set(node, {});
        initialModels.get(node)![target.binding.name!] = model;
      } else {
        try {
          nativeModels.set(
            target,
            bindNativeModel(node, target.binding.name!, model, owner, {
              isActive: () => active() && !owner.disposed,
              onError: (error) => options.onError(new TemplateError(target.binding.source, error)),
            }),
          );
        } catch (error) {
          throw new TemplateError(target.binding.source, error);
        }
      }
      for (const attr of [...node.attributes])
        if (attr.name.startsWith('model:')) node.removeAttribute(attr.name);
    }
  for (const target of targets) {
    if (target.binding.kind !== 'event') continue;
    const node = target.node as Element,
      name = target.binding.name!;
    const listener = (event: unknown): void => {
      if (!active() || owner.disposed) return;
      try {
        const result = evaluate(target, event);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function')
          void Promise.resolve(result).catch((error) =>
            options.onError(new TemplateError(target.binding.source, error)),
          );
      } catch (error) {
        options.onError(error);
      }
    };
    if (options.isChild(node)) {
      if (!outputs.has(node)) outputs.set(node, {});
      outputs.get(node)![name] = listener;
    } else {
      node.addEventListener(name, listener);
      owner.scope.own(() => node.removeEventListener(name, listener));
    }
    for (const attr of [...node.attributes])
      if (attr.name.startsWith('@')) node.removeAttribute(attr.name);
  }
  const selectModels = new Set(
    [...nativeModels.keys()].filter((target) => (target.node as Element).localName === 'select'),
  );
  let initialized = false;
  function render(): void {
    try {
      commit();
    } finally {
      options.finished?.();
    }
  }
  function commit(): void {
    if (!active() || owner.disposed) return;
    const values = targets
      .filter(
        (t) =>
          !['event', 'when', 'each', 'slot', 'projection'].includes(t.binding.kind) &&
          (t.binding.kind !== 'model' || nativeModels.has(t)),
      )
      .map((target) => {
        let value =
          target.binding.kind === 'model' ? nativeModels.get(target)!.read() : evaluate(target);
        if (target.binding.kind === 'text') value = value == null ? '' : String(value);
        if (
          target.binding.kind === 'property' &&
          target.binding.name === 'class' &&
          !options.isChild(target.node as Element)
        )
          value = className(value);
        return { target, value };
      });
    const changed = values.filter(
      ({ target, value }) => !previous.has(target) || !Object.is(previous.get(target), value),
    );
    const conditions = targets
      .filter((t) => t.binding.kind === 'when' || t.binding.kind === 'slot')
      .map((target) => {
        const value = evaluate(target);
        if (typeof value !== 'boolean')
          throw new TemplateError(target.binding.source, new Error('when requires a boolean'));
        return { target, value };
      });
    const collections = targets
      .filter((t) => t.binding.kind === 'each')
      .map((target) => {
        const collection = evaluate(target);
        if (!Array.isArray(collection))
          throw new TemplateError(target.binding.source, new Error('each requires an array'));
        const seen = new Set<string | number>();
        const items = collection.map((value) => {
          let key: unknown;
          try {
            key = target.binding.key!(scopeFor({ ...exposed, [target.binding.item!]: value }));
          } catch (error) {
            throw new TemplateError(target.binding.source, error);
          }
          if (
            (typeof key !== 'string' && typeof key !== 'number') ||
            (typeof key === 'number' && !Number.isFinite(key))
          )
            throw new TemplateError(
              target.binding.source,
              new Error('each key must be a finite number or string'),
            );
          if (seen.has(key))
            throw new TemplateError(target.binding.source, new Error(`Duplicate each key: ${key}`));
          seen.add(key);
          return { key, value };
        });
        return { target, items };
      });
    const writes = changed.some(
      ({ target, value }) =>
        !selectModels.has(target) &&
        (target.binding.kind !== 'model' ||
          nativeModels
            .get(target)!
            .needsWrite(value as ReturnType<ReturnType<typeof bindNativeModel>['read']>)),
    );
    if (initialized && writes) options.beforeUpdate();
    const childPatches = new Map<Element, Record<string, unknown>>();
    for (const { target, value } of changed) {
      if (selectModels.has(target)) continue;
      const { binding, node } = target;
      if (binding.kind === 'model') {
        try {
          nativeModels
            .get(target)!
            .apply(value as ReturnType<ReturnType<typeof bindNativeModel>['read']>);
        } catch (error) {
          throw new TemplateError(binding.source, error);
        }
      }
      if (binding.kind === 'property') {
        const element = node as Element,
          name = binding.name!;
        if (options.isChild(element)) {
          if (!childPatches.has(element)) childPatches.set(element, {});
          childPatches.get(element)![name] = value;
        } else {
          try {
            setProperty(element, name, value);
          } catch (error) {
            throw new TemplateError(binding.source, error);
          }
        }
        // Compiler names for custom inputs may be camelCase; remove syntax attributes once mounted.
        for (const attr of [...element.attributes])
          if (attr.name.startsWith(':')) element.removeAttribute(attr.name);
      }
      previous.set(target, value);
    }
    for (const [node, original] of textOriginals) {
      const next = original.replace(/{{([\s\S]*?)}}/g, (_match, _expression, index: number) => {
        const target = targets.find(
          (t) => t.node === node && t.binding.kind === 'text' && t.binding.name === String(index),
        );
        return target ? String(previous.get(target) ?? '') : '';
      });
      if (node.textContent !== next) node.textContent = next;
    }
    for (const [node, patch] of childPatches) {
      const child = children.get(node);
      if (child) child.setInputs(patch);
      else initialInputs.set(node, patch);
    }
    for (const { target, value } of conditions) {
      const branch = branches.get(target);
      if (value && !branch) {
        if (initialized) options.beforeUpdate();
        const projection =
          target.binding.kind === 'slot' &&
          options.slots &&
          Object.hasOwn(options.slots, target.binding.name!)
            ? options.slots[target.binding.name!]
            : undefined;
        const next = projection
          ? projection.mount(owner, options.beforeUpdate)
          : options.createView(target.binding.view!, exposed, owner);
        try {
          target.node.parentNode!.insertBefore(next.fragment, target.node.nextSibling);
          branches.set(target, next);
        } catch (error) {
          next.dispose();
          throw error;
        }
      } else if (!value && branch) {
        if (initialized) options.beforeUpdate();
        branches.delete(target);
        branch.dispose();
      }
      branches.get(target)?.render();
    }
    for (const { target, items } of collections) {
      const previousRows = lists.get(target) ?? new Map(),
        keys = [...previousRows.keys()];
      const structureChanged =
        keys.length !== items.length || items.some((item, i) => item.key !== keys[i]);
      if (initialized && structureChanged) options.beforeUpdate();
      const rows = new Map<
          (typeof items)[number]['key'],
          { branch: TemplateBranch; cell: WritableSignal<unknown>; input: unknown }
        >(),
        created: TemplateBranch[] = [];
      try {
        for (const item of items) {
          let row = previousRows.get(item.key);
          if (!row) {
            const cell = signal(item.value),
              branch = options.createView(
                target.binding.view!,
                { ...exposed, [target.binding.item!]: cell },
                owner,
              );
            created.push(branch);
            row = { branch, cell, input: item.value };
          }
          rows.set(item.key, row);
        }
      } catch (error) {
        const errors = [error];
        for (const branch of created)
          try {
            branch.dispose();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        throw errors.length === 1
          ? error
          : new AggregateError(errors, 'each candidate cleanup failed');
      }
      lists.set(target, rows);
      const failures: unknown[] = [];
      for (const [key, row] of previousRows)
        if (!rows.has(key))
          try {
            row.branch.dispose();
          } catch (error) {
            failures.push(error);
          }
      let cursor = target.node.nextSibling;
      for (const item of items) {
        const row = rows.get(item.key)!;
        if (!Object.is(row.input, item.value)) {
          row.cell.set(item.value);
          row.input = item.value;
        }
        const nodes = row.branch.nodes();
        if (nodes[0] !== cursor)
          for (const node of nodes) target.node.parentNode!.insertBefore(node, cursor);
        cursor = nodes.at(-1)!.nextSibling;
        row.branch.render();
      }
      if (failures.length) throw new AggregateError(failures, 'each removed row cleanup failed');
    }
    // Option creation/removal/value bindings can change selection even when the model is unchanged.
    for (const { target, value } of values) {
      if (!selectModels.has(target)) continue;
      const model = nativeModels.get(target)!;
      const state = value as ReturnType<typeof model.read>;
      try {
        const writes = model.needsWrite(state);
        if (initialized && writes) options.beforeUpdate();
        if (!previous.has(target) || previous.get(target) !== value || writes) model.apply(state);
        previous.set(target, value);
      } catch (error) {
        throw new TemplateError(target.binding.source, error);
      }
    }
    options.updated();
    initialized = true;
  }
  render();
  if (options.subscribe !== false) effect(render, owner.scope, { onError: options.onError });
  return {
    initialInputs,
    projections,
    initialModels,
    outputs,
    render,
    connect(node: Element, child: ChildTarget) {
      children.set(node, child);
    },
    activate() {
      for (const branch of branches.values()) branch.activate();
      for (const rows of lists.values()) for (const row of rows.values()) row.branch.activate();
      for (const model of nativeModels.values()) model.resume();
      active.set(true);
    },
    deactivate() {
      for (const branch of branches.values()) branch.deactivate();
      for (const rows of lists.values()) for (const row of rows.values()) row.branch.deactivate();
      for (const model of nativeModels.values()) model.pause();
      active.set(false);
    },
  };
}
