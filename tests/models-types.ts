import {
  signal,
  computed,
  writableModel,
  type NativeValueModel,
  type ConvertedModel,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const count = signal(1);
const number = writableModel({
  get: count,
  set: (value: number) => count.set(value),
  convert: 'number',
});
const numeric: NativeValueModel = number;
number.set(2);
number.update((n) => n + 1);
number.resetDraft();
const list = signal<string[]>([]);
const multi = writableModel({
  get: list,
  set: (value: string[]) => list.set(value),
  convert: 'strings',
});
const selected: ConvertedModel<readonly string[]> = multi;
// @ts-expect-error native numeric values require explicit conversion
const missing: NativeValueModel = count;
// @ts-expect-error readonly derived values cannot be models
const readonly: NativeValueModel = computed(() => '');
// @ts-expect-error incompatible conversion
writableModel({ get: count, set: (value: number) => count.set(value), convert: 'strings' });
// @ts-expect-error wrong write type
number.set('2');
// @ts-expect-error validation is readonly
number.validation.set({ valid: true });
void numeric;
void selected;
void missing;
void readonly;
