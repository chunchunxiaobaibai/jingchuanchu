import { SIGNAL, signal, type WritableSignal, type ReadSignal } from './reactivity.js';
import type { ReadonlyData } from '../state.js';
import type { ComponentOwner } from './component-owner.js';

export const MODEL = Symbol('application model adapter');
export type ModelConversion<T> = T extends number
  ? 'number'
  : T extends boolean
    ? 'boolean'
    : T extends readonly string[]
      ? 'strings'
      : T extends string
        ? 'string'
        : never;
export type ModelValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'empty-number' | 'invalid-number' };
export interface WritableModelOptions<T> {
  get: () => ReadonlyData<T>;
  set: (value: T) => void;
  event?: 'input' | 'change';
  convert?: ModelConversion<T>;
}
export interface WritableModel<T> extends WritableSignal<T> {
  readonly [MODEL]: {
    readonly event: 'input' | 'change';
    readonly convert: ModelConversion<T> | undefined;
    readonly revision: ReadSignal<number>;
    edit: (draft: unknown, validation: ModelValidation) => void;
  };
  readonly draft: ReadSignal<unknown>;
  readonly validation: ReadSignal<ModelValidation>;
  resetDraft(): void;
}
export type ConvertedModel<T> = WritableModel<T> & {
  readonly [MODEL]: { readonly convert: ModelConversion<T> };
};
export type NativeValueModel =
  WritableSignal<string> | ConvertedModel<number> | ConvertedModel<readonly string[]>;
export function writableModel<T>(
  options: WritableModelOptions<T> & { convert: ModelConversion<T> },
): ConvertedModel<T>;
export function writableModel<T>(options: WritableModelOptions<T>): WritableModel<T>;
export function writableModel<T>(options: WritableModelOptions<T>): WritableModel<T> {
  if (options.event && !['input', 'change'].includes(options.event))
    throw new Error('Model event must be input or change');
  if (options.convert && !['string', 'number', 'boolean', 'strings'].includes(options.convert))
    throw new Error('Unsupported model conversion');
  const draft = signal<unknown>(undefined),
    validation = signal<ModelValidation>({ valid: true }),
    revision = signal(0);
  const read = (() => options.get()) as WritableModel<T>;
  Object.defineProperties(read, {
    [SIGNAL]: { value: true },
    [MODEL]: {
      value: Object.freeze({
        event: options.event ?? 'input',
        convert: options.convert,
        revision,
        edit: (value: unknown, result: ModelValidation) => {
          draft.set(value);
          validation.set(result);
        },
      }),
    },
    draft: { value: draft },
    validation: { value: validation },
  });
  read.set = (value) => options.set(value);
  read.update = (reduce) => read.set(reduce(read()));
  read.resetDraft = () => {
    draft.set(undefined);
    validation.set({ valid: true });
    revision.update((n) => n + 1);
  };
  return read;
}

/** Native form state belongs to a DOM binding, including composition and uncommitted drafts. */
export function bindNativeModel(
  node: Element,
  name: string,
  target: WritableSignal<unknown>,
  owner: ComponentOwner,
  options: { isActive: () => boolean; onError: (error: unknown) => void },
) {
  if (!(
    target &&
    typeof target === 'function' &&
    SIGNAL in target &&
    typeof target.set === 'function'
  ))
    throw new Error('Model requires a writable signal or writableModel adapter');
  const tag = node.localName;
  if (
    !['input', 'textarea', 'select'].includes(tag) ||
    !['value', 'checked'].includes(name) ||
    (name === 'checked' &&
      (tag !== 'input' || !['checkbox', 'radio'].includes((node as HTMLInputElement).type)))
  )
    throw new Error(`Unsupported native model ${tag}:${name}`);
  const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const adapter =
    MODEL in target
      ? (target as WritableModel<string | number | boolean | readonly string[]>)[MODEL]
      : undefined;
  const convert = adapter?.convert ?? (name === 'checked' ? 'boolean' : 'string');
  if ((name === 'checked' && convert !== 'boolean') || (name === 'value' && convert === 'boolean'))
    throw new Error('Model conversion does not match the bound property');
  if (convert === 'strings' && (tag !== 'select' || !(element as HTMLSelectElement).multiple))
    throw new Error('strings conversion requires select multiple');
  if (tag === 'select' && (element as HTMLSelectElement).multiple && convert !== 'strings')
    throw new Error('select multiple requires strings conversion');
  if (convert === 'number' && tag === 'select')
    throw new Error('Number conversion requires input or textarea');
  const compositionRevision = signal(0);
  let composing = false,
    invalid = false,
    lastValue: unknown,
    lastRevision = -1,
    initialized = false;
  let cached: { value: unknown; revision: number; edit: number } | undefined;
  const read = () => {
    const value = target(),
      revision = adapter?.revision() ?? 0,
      edit = compositionRevision();
    if (composing && cached) return cached;
    if (
      !cached ||
      !Object.is(cached.value, value) ||
      cached.revision !== revision ||
      cached.edit !== edit
    )
      cached = { value, revision, edit };
    return cached;
  };
  const raw = (): unknown =>
    name === 'checked'
      ? (element as HTMLInputElement).checked
      : convert === 'strings'
        ? [...(element as HTMLSelectElement).options]
            .filter((option) => option.selected)
            .map((option) => option.value)
        : element.value;
  function commit(): void {
    if (!options.isActive() || owner.disposed || composing) return;
    try {
      const draft = raw();
      let value = draft;
      if (convert === 'number') {
        if (String(draft).trim() === '') {
          invalid = true;
          adapter?.edit(draft, { valid: false, reason: 'empty-number' });
          return;
        }
        value = Number(draft);
        if (!Number.isFinite(value)) {
          invalid = true;
          adapter?.edit(draft, { valid: false, reason: 'invalid-number' });
          return;
        }
      }
      invalid = false;
      adapter?.edit(draft, { valid: true });
      if (!Object.is(target(), value)) target.set(value);
      compositionRevision.update((n) => n + 1);
    } catch (error) {
      options.onError(error);
    }
  }
  const event = adapter?.event ?? 'input';
  const start = () => {
    if (options.isActive() && !owner.disposed) composing = true;
  };
  const end = () => {
    composing = false;
    if (event === 'input') {
      commit();
      compositionRevision.update((n) => n + 1);
    } else if (!Object.is(target(), lastValue) || (adapter?.revision() ?? 0) !== lastRevision)
      compositionRevision.update((n) => n + 1);
  };
  element.addEventListener(event, commit);
  element.addEventListener('compositionstart', start);
  element.addEventListener('compositionend', end);
  owner.scope.own(() => {
    element.removeEventListener(event, commit);
    element.removeEventListener('compositionstart', start);
    element.removeEventListener('compositionend', end);
  });
  function apply(state: { value: unknown; revision: number }): void {
    const external =
      !initialized || !Object.is(lastValue, state.value) || lastRevision !== state.revision;
    if (composing) return;
    if (invalid && !external) return;
    if (external) {
      invalid = false;
      adapter?.edit(undefined, { valid: true });
    }
    const value = state.value;
    if (name === 'checked') {
      if (typeof value !== 'boolean') throw new Error('checked model requires a boolean');
      (element as HTMLInputElement).checked = value;
    } else if (convert === 'strings') {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
        throw new Error('Multiple select model requires a string array');
      for (const option of (element as HTMLSelectElement).options)
        option.selected = value.includes(option.value);
    } else {
      if (
        (convert === 'number' && typeof value !== 'number') ||
        (convert === 'string' && typeof value !== 'string')
      )
        throw new Error(`Model requires ${convert} values`);
      const desired = String(value);
      const sameNumeric =
        lastRevision === state.revision &&
        convert === 'number' &&
        element.value.trim() !== '' &&
        Number(element.value) === value;
      if (element.value !== desired && !sameNumeric) element.value = desired;
    }
    lastValue = value;
    lastRevision = state.revision;
    initialized = true;
  }
  function needsWrite(state: { value: unknown; revision: number }): boolean {
    if (
      composing ||
      (invalid &&
        initialized &&
        Object.is(lastValue, state.value) &&
        lastRevision === state.revision)
    )
      return false;
    if (name === 'checked') return (element as HTMLInputElement).checked !== state.value;
    if (convert === 'strings')
      return [...(element as HTMLSelectElement).options].some(
        (option) =>
          option.selected !== (Array.isArray(state.value) && state.value.includes(option.value)),
      );
    if (
      tag === 'select' &&
      ![...(element as HTMLSelectElement).options].some(
        (option) => option.value === String(state.value),
      )
    )
      return (element as HTMLSelectElement).selectedIndex !== -1;
    if (
      convert === 'number' &&
      lastRevision === state.revision &&
      element.value.trim() !== '' &&
      Number(element.value) === state.value
    )
      return false;
    return element.value !== String(state.value);
  }
  return {
    read,
    apply,
    needsWrite,
    pause() {
      composing = false;
    },
    resume() {
      compositionRevision.update((n) => n + 1);
    },
  };
}
