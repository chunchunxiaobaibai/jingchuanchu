import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  GameCanvas,
  defineGameScene,
  defineActions,
  mountComponent,
  defineApplication,
  defineComponent,
  mountApplication,
  defineStore,
  signal,
  type GameCanvasHandle,
  type GameCanvasOptions,
  type GameCanvasStatus,
  type CanvasHostError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
function fixture() {
  const window = new Window(),
    document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { get: () => 200, configurable: true },
    clientHeight: { get: () => 100, configurable: true },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function () {
      return { left: 10, top: 20, width: 200, height: 100 };
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ setTransform() {}, fillRect() {} }),
  });
  const frames = new Map<number, (time: number) => void>(),
    listeners = new Set<() => void>();
  let nextId = 0;
  const options: GameCanvasOptions = {
    width: 100,
    height: 50,
    clock: { tickRate: 10 },
    driver: {
      requestFrame(callback) {
        const id = ++nextId;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id) {
        frames.delete(id);
      },
      isHidden: () => false,
      subscribeVisibility(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
  };
  return {
    window,
    document,
    host,
    options,
    frames,
    listeners,
    frame(time: number) {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(time);
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('public GameCanvas mounts, emits ready/status, preserves manual pause through page activation and guards typed scene controls', async () => {
  const f = fixture(),
    states: GameCanvasStatus[] = [],
    errors: CanvasHostError[] = [];
  let handle: GameCanvasHandle | undefined,
    ticks = 0,
    presses = 0;
  const scene = defineGameScene({
    id: 'play',
    actions: defineActions({
      move: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] },
      fire: { kind: 'button', keys: ['Space'] },
    }),
    setup(c) {
      c.addSystem({
        id: 'rule',
        update() {
          ticks++;
          if (c.actions.buttons.fire.pressed) presses++;
        },
      });
    },
  });
  const next = defineGameScene({ id: 'next', setup() {} });
  const mounted = mountComponent(f.host, GameCanvas, {
    inputs: { scene, options: f.options },
    outputs: {
      ready: (value) => {
        handle = value;
      },
      statusChanged: (value) => {
        states.push(value);
      },
      error: (error) => {
        errors.push(error);
      },
    },
  });
  try {
    await settle();
    assert.ok(handle);
    assert.equal(handle.status(), 'running');
    assert.equal(f.frames.size, 1);
    assert.deepEqual(states, ['preparing', 'running']);
    const controls = handle.forScene(scene);
    controls.setVirtual('fire', true, 'hud');
    f.frame(0);
    f.frame(100);
    assert.equal(ticks, 1);
    assert.equal(presses, 1);
    handle.pause();
    assert.equal(handle.status(), 'paused');
    assert.equal(f.frames.size, 0);
    mounted.deactivate();
    mounted.activate();
    assert.equal(handle.status(), 'paused');
    handle.resume();
    assert.equal(f.frames.size, 1);
    await handle.restart();
    assert.equal(f.frames.size, 1);
    assert.equal(handle.status(), 'running');
    const failed = defineGameScene({
      id: 'failed',
      prepare() {
        throw new Error('load failed');
      },
      setup() {},
    });
    await assert.rejects(handle.switchTo(failed, {}));
    assert.equal(errors.length, 1);
    assert.equal(handle.status(), 'running');
    controls.setVirtual('fire', false, 'hud');
    await handle.switchTo(next, {});
    assert.throws(() => controls.setVirtual('fire', true), /not committed/);
    mounted.setInputs({ scene: next });
    await settle();
    mounted.setInputs({ scene });
    await settle();
    handle.forScene(scene).setVirtual('fire', true);
    assert.equal(f.frames.size, 1);
  } finally {
    mounted.dispose();
  }
  assert.equal(handle!.status(), 'disposed');
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.throws(() => handle!.pause(), /not active/);
  assert.equal(f.host.children.length, 0);
});

test('application template GameCanvas shares a Store with its page and disposes a pending scene on app exit', async () => {
  const f = fixture();
  let handle: GameCanvasHandle | undefined,
    finish!: () => void,
    late = 0;
  const Store = defineStore({
    name: 'canvas-score',
    setup() {
      const score = signal(0);
      return {
        state: { score },
        getters: {},
        actions: {
          add() {
            score.update((v) => v + 1);
          },
        },
      };
    },
  });
  const scene = defineGameScene({
    id: 'shared',
    setup(c) {
      c.useStore(Store).actions.add();
    },
  });
  const Root = defineComponent({
    selector: 'canvas-page-root',
    components: [GameCanvas],
    $template: '<game-canvas></game-canvas>',
    $bindings: [
      { path: [0], kind: 'property', name: 'scene', source: 'scene', evaluate: (s) => s.scene },
      {
        path: [0],
        kind: 'property',
        name: 'options',
        source: 'options',
        evaluate: (s) => s.options,
      },
      {
        path: [0],
        kind: 'event',
        name: 'ready',
        source: 'ready',
        evaluate: (s, event) =>
          (s.ready as (value: GameCanvasHandle) => void)(event as GameCanvasHandle),
      },
    ],
    setup(c) {
      return {
        scene,
        options: f.options,
        store: c.useStore(Store),
        ready(value: GameCanvasHandle) {
          handle = value;
        },
      };
    },
  });
  const app = await mountApplication(f.host, defineApplication({ root: Root }));
  await settle();
  assert.ok(handle);
  assert.equal(app.root.exposed.store.state.score(), 1);
  const slow = defineGameScene({
    id: 'slow',
    prepare: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    setup() {
      late++;
    },
  });
  const pending = handle.switchTo(slow, {}).then(
    () => false,
    () => true,
  );
  app.dispose();
  assert.equal(await pending, true);
  finish();
  await settle();
  assert.equal(late, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
});
