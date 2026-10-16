import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  defineView,
  viewInputs,
  mountView,
  StateStore,
  defineGame,
  defineScene,
  defineInput,
  mountGame,
  bootstrapGame,
} from '@xiaobaibaifqy/jingchuanchu-app';
import type { BrowserDriver } from '@xiaobaibaifqy/jingchuanchu-browser';

const settle = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};
function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('game-root');
  document.body.append(host);
  return { document, host };
}
type State = { count: number; nested?: { value: number } };
type Commands = { increment: number; pause: undefined };

test('state snapshots cannot mutate game data; subscriptions belong to their scope', () => {
  const original = { count: 1, nested: { value: 2 } },
    state = new StateStore(original),
    scope = new Scope();
  original.nested.value = 3;
  assert.equal(state.value.nested.value, 2);
  assert.throws(() => {
    (state.value.nested as { value: number }).value = 5;
  });
  let notifications = 0;
  state.subscribe(() => notifications++, scope);
  state.update((previous) => ({ ...previous, count: 2 }));
  scope.dispose();
  state.update((previous) => ({ ...previous, count: 3 }));
  assert.equal(notifications, 1);
});

test('view instances isolate local state, batch inputs and clean event listeners', async () => {
  const { host, document } = dom(),
    second = document.createElement('game-root');
  document.body.append(second);
  const state = new StateStore<State>({ count: 0 }),
    errors: unknown[] = [],
    calls: string[] = [];
  let change: unknown;
  const view = defineView<State, Commands, { label: string }, { clicks: number }>({
    selector: 'game-counter',
    $template: '<button data-ref="button" data-text="label" data-on-click="click"></button>',
    local: () => ({ clicks: 0 }),
    text: { label: (c) => `${c.inputs.label}:${c.local.clicks}` },
    actions: { click: (c) => c.setLocal((value) => ({ clicks: value.clicks + 1 })) },
    onInit() {
      calls.push('init');
    },
    onMount() {
      calls.push('mount');
    },
    onInputsChanged(_, value) {
      change = value;
      calls.push('inputs');
    },
    onBeforeUpdate() {
      calls.push('before');
    },
    onUpdated() {
      calls.push('updated');
    },
    onDestroy() {
      calls.push('destroy');
    },
  });
  const env = { state, commands: { send() {} }, onError: (error: unknown) => errors.push(error) };
  const a = mountView(host, view, env, { label: 'a' }),
    b = mountView(second, view, env, { label: 'b' });
  const button = host.querySelector('button')!;
  button.dispatchEvent(new host.ownerDocument.defaultView!.Event('click'));
  a.setInputs({ label: 'intermediate' });
  a.setInputs({ label: 'final' });
  await settle();
  assert.equal(button.textContent, 'final:1');
  assert.equal(second.textContent, 'b:0');
  assert.deepEqual(change, { previous: { label: 'a' }, current: { label: 'final' } });
  assert.deepEqual(calls, ['init', 'mount', 'init', 'mount', 'inputs', 'before', 'updated']);
  a.dispose();
  a.dispose();
  button.dispatchEvent(new document.defaultView!.Event('click'));
  assert.equal(host.childNodes.length, 0);
  assert.equal(calls.filter((c) => c === 'destroy').length, 1);
  assert.throws(() => a.activate());
  b.dispose();
  assert.deepEqual(errors, []);
});

test('parent/child input, lifecycle order, activation and failed cleanup follow instance ownership', async () => {
  const { host } = dom(),
    state = new StateStore<State>({ count: 1 }),
    calls: string[] = [],
    errors: unknown[] = [];
  const child = defineView<State, Commands, { value: number }>({
    selector: 'game-child',
    $template: '<span data-text="value"></span>',
    text: { value: (c) => c.inputs.value },
    onInit(c) {
      calls.push(`child:init:${c.inputs.value}`);
    },
    onMount() {
      calls.push('child:mount');
    },
    onUpdated() {
      calls.push('child:updated');
    },
    onDeactivate() {
      calls.push('child:off');
    },
    onActivate() {
      calls.push('child:on');
    },
    onDestroy() {
      calls.push('child:destroy');
      throw new Error('child cleanup');
    },
  });
  const parent = defineView<State, Commands>({
    selector: 'game-parent',
    components: [child],
    $template: '<p data-text="count"></p><game-child></game-child>',
    text: { count: (c) => c.state.count },
    childInputs: (c) => [viewInputs(child, { value: c.state.count })],
    onInit() {
      calls.push('parent:init');
    },
    onMount() {
      calls.push('parent:mount');
    },
    onBeforeUpdate() {
      calls.push('parent:before');
    },
    onUpdated() {
      calls.push('parent:updated');
    },
    onDestroy(c) {
      assert.ok(host.querySelector('p'));
      c.own(() => calls.push('parent:cleanup'));
      calls.push('parent:destroy');
    },
  });
  const instance = mountView(host, parent, {
    state,
    commands: { send() {} },
    onError: (e) => errors.push(e),
  });
  assert.deepEqual(calls, ['parent:init', 'child:init:1', 'child:mount', 'parent:mount']);
  calls.length = 0;
  state.update(() => ({ count: 2 }));
  await settle();
  assert.deepEqual(calls, ['parent:before', 'child:updated', 'parent:updated']);
  instance.deactivate();
  state.update(() => ({ count: 3 }));
  await settle();
  assert.equal(host.querySelector('span')!.textContent, '2');
  instance.activate();
  await settle();
  assert.equal(host.querySelector('span')!.textContent, '3');
  assert.throws(() => instance.dispose(), AggregateError);
  assert.ok(calls.indexOf('child:destroy') < calls.indexOf('parent:destroy'));
  assert.ok(calls.includes('parent:cleanup'));
  assert.equal(host.childNodes.length, 0);
  assert.deepEqual(errors, []);
});

test('mount failure rolls back children and subscriptions, allowing another mount', () => {
  const { host } = dom(),
    state = new StateStore<State>({ count: 1 });
  let cleaned = 0;
  const bad = defineView<State, Commands>({
    selector: 'game-bad',
    $template: '<div></div>',
    onInit(c) {
      c.own(() => cleaned++);
    },
    onMount() {
      throw new Error('mount');
    },
  });
  assert.throws(
    () => mountView(host, bad, { state, commands: { send() {} }, onError() {} }),
    /onMount/,
  );
  assert.equal(cleaned, 1);
  assert.equal(host.childNodes.length, 0);
  const good = defineView<State, Commands>({ selector: 'game-good', $template: '<span>ok</span>' });
  mountView(host, good, { state, commands: { send() {} }, onError() {} }).dispose();
});

test('application binds scene commands, sampled input and scoped scene replacement', async () => {
  const { host, document } = dom(),
    frames = new Map<number, (time: number) => void>();
  let frameId = 0;
  const driver: BrowserDriver = {
    requestFrame: (fn) => {
      frames.set(++frameId, fn);
      return frameId;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    isHidden: () => false,
    subscribeVisibility: () => () => {},
  };
  let input = 0,
    cleaned = 0;
  const play = defineScene<State, Commands, { x: number }>({
    setup(c) {
      c.create();
      c.commands.handle('increment', (count) =>
        c.state.update((s) => ({ ...s, count: s.count + count })),
      );
      c.addSystem({
        id: 'read',
        update() {
          input = c.input.x;
        },
      });
      c.scope.own(() => cleaned++);
    },
  });
  const next = defineScene<State, Commands, { x: number }>({
    setup(c) {
      c.commands.handle('increment', (count) => c.state.update(() => ({ count: count * 2 })));
    },
  });
  const root = defineView<State, Commands>({
    selector: 'game-root',
    $template: '<span data-text="count"></span>',
    text: { count: (c) => c.state.count },
  });
  const game = defineGame<State, Commands, { x: number }>({
    state: () => ({ count: 0 }),
    scenes: [play, next],
    initialScene: play,
    input: defineInput({
      initial: () => ({ x: 0 }),
      read: (keyboard) => ({ x: Number(keyboard.isDown('KeyD')) }),
    }),
    setup(c) {
      c.commands.handle('pause', () =>
        c.engine.status === 'paused' ? c.engine.resume() : c.engine.pause(),
      );
    },
  });
  const app = await bootstrapGame(root, game, { document, driver });
  await assert.rejects(mountGame(host, root, game, { driver }), /already mounted/);
  const key = Object.assign(new document.defaultView!.Event('keydown'), { code: 'KeyD' });
  host.dispatchEvent(key);
  app.engine.advance(app.engine.step);
  assert.equal(input, 1);
  app.commands.send('increment', 3);
  await settle();
  assert.equal(host.textContent, '3');
  app.commands.send('pause', undefined);
  app.commands.send('increment', 9);
  assert.equal(app.state.value.count, 3);
  app.commands.send('pause', undefined);
  await app.switchTo(next);
  assert.equal(cleaned, 1);
  assert.equal(app.engine.world.size, 0);
  app.commands.send('increment', 4);
  assert.equal(app.state.value.count, 8);
  app.dispose();
  assert.equal(frames.size, 0);
  assert.equal(host.childNodes.length, 0);
});

test('scene cleanup failure keeps newly committed commands and failed startup releases the host', async () => {
  const { host } = dom();
  const driver: BrowserDriver = {
    requestFrame: () => 1,
    cancelFrame() {},
    isHidden: () => false,
    subscribeVisibility: () => () => {},
  };
  const root = defineView<State, Commands>({ selector: 'game-root', $template: '<div></div>' });
  const old = defineScene<State, Commands>({
    setup(c) {
      c.scope.own(() => {
        throw new Error('retire');
      });
    },
  });
  const next = defineScene<State, Commands>({
    setup(c) {
      c.commands.handle('increment', (count) => c.state.update(() => ({ count })));
    },
  });
  const app = await mountGame(
    host,
    root,
    defineGame<State, Commands>({
      state: () => ({ count: 0 }),
      scenes: [old, next],
      initialScene: old,
    }),
    { driver },
  );
  await assert.rejects(app.switchTo(next), /Scope cleanup/);
  app.commands.send('increment', 7);
  assert.equal(app.state.value.count, 7);
  app.dispose();
  await assert.rejects(
    mountGame(
      host,
      root,
      defineGame<State, Commands>({
        state: () => {
          throw new Error('initial');
        },
      }),
      { driver },
    ),
    /initial/,
  );
  (
    await mountGame(host, root, defineGame<State, Commands>({ state: () => ({ count: 0 }) }), {
      driver,
    })
  ).dispose();
});

test('writes from update hooks run in later batches; no DOM changes produce no update hooks', async () => {
  const { host } = dom(),
    state = new StateStore<State>({ count: 0 }),
    seen: number[] = [];
  const view = defineView<State, Commands>({
    selector: 'game-root',
    $template: '<span data-text="count"></span>',
    text: { count: (c) => c.state.count },
    onUpdated(c) {
      seen.push(c.state.count);
      if (c.state.count === 1) state.update(() => ({ count: 2 }));
    },
  });
  const instance = mountView(host, view, {
    state,
    commands: { send() {} },
    onError(error) {
      throw error;
    },
  });
  state.update(() => ({ count: 1 }));
  await settle();
  assert.deepEqual(seen, [1, 2]);
  state.update(() => ({ count: 2 }));
  await settle();
  assert.deepEqual(seen, [1, 2]);
  instance.dispose();
});

test('a component tree shares one state snapshot and updates parents before children', async () => {
  const { host } = dom(),
    state = new StateStore<State>({ count: 0 }),
    order: string[] = [];
  const child = defineView<State, Commands>({
    selector: 'game-child',
    $template: '<span data-text="count"></span>',
    text: { count: (c) => c.state.count },
    onBeforeUpdate(c) {
      order.push(`child:before:${c.state.count}`);
    },
    onUpdated(c) {
      order.push(`child:after:${c.state.count}`);
    },
  });
  const root = defineView<State, Commands>({
    selector: 'game-root',
    components: [child],
    $template: '<p data-text="count"></p><game-child></game-child>',
    text: { count: (c) => c.state.count },
    onBeforeUpdate(c) {
      order.push(`parent:before:${c.state.count}`);
      if (c.state.count === 1) state.update(() => ({ count: 2 }));
    },
    onUpdated(c) {
      order.push(`parent:after:${c.state.count}`);
    },
  });
  const instance = mountView(host, root, {
    state,
    commands: { send() {} },
    onError(error) {
      throw error;
    },
  });
  state.update(() => ({ count: 1 }));
  await settle();
  assert.deepEqual(order, [
    'parent:before:1',
    'child:before:1',
    'child:after:1',
    'parent:after:1',
    'parent:before:2',
    'child:before:2',
    'child:after:2',
    'parent:after:2',
  ]);
  instance.dispose();
});

test('a child local write in onMount is rendered after the parent finishes mounting', async () => {
  const { host } = dom(),
    state = new StateStore<State>({ count: 0 });
  const child = defineView<State, Commands, Record<string, never>, { ready: boolean }>({
    selector: 'game-child',
    local: () => ({ ready: false }),
    $template: '<span data-text="ready"></span>',
    text: { ready: (c) => String(c.local.ready) },
    onMount(c) {
      c.setLocal(() => ({ ready: true }));
    },
  });
  const root = defineView<State, Commands>({
    selector: 'game-root',
    components: [child],
    $template: '<game-child></game-child>',
  });
  const view = mountView(host, root, {
    state,
    commands: { send() {} },
    onError(error) {
      throw error;
    },
  });
  await settle();
  assert.equal(host.textContent, 'true');
  view.dispose();
});
