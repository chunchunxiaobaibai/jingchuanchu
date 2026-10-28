import {
  computed,
  signal,
  type ReadSignal,
  type WritableSignal,
  type ReadonlyData,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { defineGame, defineView, StateStore } from '@xiaobaibaifqy/jingchuanchu-app';
// @ts-expect-error New reactive APIs must not silently extend the legacy root entry.
import { signal as legacySignal } from '@xiaobaibaifqy/jingchuanchu-app';
import { effect, batch } from '@xiaobaibaifqy/jingchuanchu-app/application';

const state: WritableSignal<{ items: { score: number }[] }> = signal({ items: [{ score: 1 }] });
const reader: ReadSignal<{ items: { score: number }[] }> = state;
const data: ReadonlyData<{ items: { score: number }[] }> = reader();
state.update((previous) => ({ items: [{ score: previous.items[0]!.score + 1 }] }));
state.set({ items: [] });
const derived = computed(() => ({ items: [state().items.length] }));
// @ts-expect-error Snapshots are deeply readonly.
data.items[0]!.score = 2;
// @ts-expect-error Snapshot arrays are readonly.
data.items.push({ score: 2 });
// @ts-expect-error Computed values do not expose writes.
derived.set({ items: [2] });
// @ts-expect-error Computed snapshots are readonly too.
derived().items.push(2);
// @ts-expect-error Signal writes keep their input type.
state.set({ items: [1] });
void [defineGame, defineView, StateStore, legacySignal, effect, batch];
