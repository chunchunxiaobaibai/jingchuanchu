import {
  defineStore,
  defineComponent,
  signal,
  computed,
  type ReadSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
const Game = defineStore({
  name: 'typed-store',
  setup() {
    const count = signal(1),
      profile = signal({ name: 'player' });
    return {
      state: { count, profile },
      getters: { double: computed(() => count() * 2) },
      actions: {
        add: (amount: number) => {
          count.update((n) => n + amount);
          return count();
        },
        async load(id: string) {
          return id.length;
        },
      },
    };
  },
});
const owner = new ComponentOwner();
const store = owner.resolve('stores', Game);
const count: ReadSignal<number> = store.state.count;
const result: number = store.actions.add(2);
const request: Promise<number> = store.actions.load('level');
// @ts-expect-error exposed state has no writable setter
store.state.count.set(2);
// @ts-expect-error readonly snapshots cannot be mutated
store.state.profile().name = 'changed';
// @ts-expect-error getter is readonly
store.getters.double.update(() => 0);
// @ts-expect-error action parameter type is preserved
store.actions.add('2');
// @ts-expect-error unknown action
store.actions.missing();
const Bad = defineStore({
  name: 'bad',
  // @ts-expect-error getter cannot be writable state
  setup() {
    return { state: { count: computed(() => 1) }, getters: {}, actions: {} };
  },
});
void count;
void result;
void request;
void Bad;

const Hud = defineComponent({
  selector: 'store-hud',
  setup(context) {
    const game = context.useStore(Game);
    const score: number = game.state.count();
    return { score: game.state.count, add: game.actions.add };
  },
});
void Hud;

const Tasks = defineStore({
  name: 'typed-tasks',
  userScoped: true,
  setup(context) {
    const count = signal(1);
    context.onReset(() => count.set(1));
    const load = () =>
      context.runTask(
        async (task) => {
          const result = task.commit(() => count() + 1);
          if (result.status === 'committed') {
            const value: number = result.value;
            void value;
          }
          // @ts-expect-error commit only accepts synchronous callbacks
          task.commit(async () => 1);
          return 2;
        },
        { key: 'load' },
      );
    return { state: { count }, getters: {}, actions: { load } };
  },
});
const taskStore = owner.resolve('stores', Tasks);
const pending: Promise<
  import('@xiaobaibaifqy/jingchuanchu-app/application').StoreTaskResult<number>
> = taskStore.actions.load();
taskStore.reset();
const scoped: boolean = taskStore.userScoped;
void pending;
void scoped;
// @ts-expect-error user-scoped policy is definition metadata, not mutable instance state
taskStore.userScoped = false;
