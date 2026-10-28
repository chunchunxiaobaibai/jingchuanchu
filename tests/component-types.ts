import {
  defineComponent,
  definePage,
  input,
  output,
  model,
  computed,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ReadSignal, WritableSignal } from '@xiaobaibaifqy/jingchuanchu-app/application';

const Editor = defineComponent({
  selector: 'nickname-editor',
  inputs: {
    label: input<string>({ default: '昵称' }),
    count: input<number>({ required: true }),
    hint: input<string>(),
  },
  outputs: { save: output<string>(), reset: output() },
  models: {
    value: model<string>({ default: '' }),
    options: model<{ enabled: boolean }>({ default: () => ({ enabled: true }) }),
  },
  setup(context) {
    const label: ReadSignal<string> = context.inputs.label;
    const count: ReadSignal<number> = context.inputs.count;
    const hint: ReadSignal<string | undefined> = context.inputs.hint;
    const value: WritableSignal<string> = context.models.value;
    context.emit('save', value());
    context.emit('reset');
    // @ts-expect-error Input signals are readonly.
    context.inputs.label.set('changed');
    // @ts-expect-error Required field retains its declared type.
    const wrong: ReadSignal<string> = context.inputs.count;
    // @ts-expect-error Unknown output.
    context.emit('missing');
    // @ts-expect-error Output payload is checked.
    context.emit('save', 1);
    // @ts-expect-error Non-void outputs require a payload.
    context.emit('save');
    // @ts-expect-error Model snapshot is deeply readonly.
    context.models.options().enabled = false;
    return { label, count, hint, value, valid: computed(() => value().length > 0), wrong };
  },
  onMount(context) {
    const valid: boolean = context.exposed.valid();
    void valid;
    // @ts-expect-error Hooks retain setup's exposed type.
    context.exposed.absent();
  },
  onInputsChanged(_, change) {
    const count: number = change.current.count;
    // @ts-expect-error Change payloads preserve field types.
    const label: number = change.current.label;
    void [count, label];
  },
});
const Page = definePage({ selector: 'settings-page', components: [Editor] });
const kind: 'page' = Page.kind;
model<boolean>({ default: () => Boolean(0) });
defineComponent({
  selector: 'inferred-view',
  inputs: { label: input({ default: 'hello' }), count: input({ default: 0 }) },
  setup(context) {
    const label: string = context.inputs.label();
    const count: number = context.inputs.count();
    return { label, count };
  },
});
// @ts-expect-error Object defaults require factory functions.
input<{ name: string }>({ default: { name: '' } });
// @ts-expect-error Array defaults require factory functions.
model<string[]>({ default: [] });
void kind;

// Explicit generics preserve hook context when hooks precede setup.
const HookFirst = defineComponent<{}, {}, {}, { caption: WritableSignal<string> }, 'hook-first'>({
  selector: 'hook-first',
  onMount(context) {
    const caption: ReadSignal<string> = context.exposed.caption;
    // @ts-expect-error setup exposes no missing field
    context.exposed.missing;
    void caption;
  },
  setup(): { caption: WritableSignal<string> } {
    return { caption: signal('ready') };
  },
});
void HookFirst;
