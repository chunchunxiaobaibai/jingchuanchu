import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import {
  defineGameScene,
  defineAssetGroup,
  defineTheme,
  defineStore,
  signal,
  type AssetGroupLease,
  type ThemeImageLease,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { StoreRegistry } from '../packages/app/runtime/store.js';
import { AssetService } from '../packages/app/runtime/asset-service.js';
import { ThemeService } from '../packages/app/runtime/theme-service.js';
import { ASSETS_CONTEXT, THEME_CONTEXT } from '../packages/app/runtime/context-keys.js';
import { createGameSceneAccess } from '../packages/app/runtime/game-scene-access.js';
import { adaptGameScene } from '../packages/app/runtime/game-scene.js';
import { defineActions, ActionSampler } from '../packages/app/runtime/input-actions.js';
const Base = defineTheme({
  name: 'scene-theme',
  tokens: { accent: 'red' },
  assets: { coin: { kind: 'image', src: '/coin.png' } },
});
const Group = defineAssetGroup({
  name: 'scene-images',
  entries: { image: { kind: 'image', url: '/scene.png' } },
});
const Game = defineStore({
  name: 'scene-shared-game',
  setup() {
    const count = signal(0);
    return {
      state: { count },
      getters: {},
      actions: { setCount: (value: number) => count.set(value) },
    };
  },
});
const neutral = new ActionSampler(defineActions({})).read();
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const image = () => ({ source: {} as CanvasImageSource, width: 16, height: 16 });

function owners() {
  const app = new ComponentOwner(undefined, { stores: new StoreRegistry([], { automatic: true }) });
  const page = new ComponentOwner(app);
  return { app, page };
}

test('scene Store/semantic assets share app providers but scene exit releases only scene leases', async () => {
  const { app, page } = owners();
  const calls: string[] = [],
    released: string[] = [];
  const assets = new AssetService(
    {
      transport: () => ({
        async load(entry) {
          calls.push(entry.url);
          return image();
        },
        release(entry) {
          released.push(entry.url);
        },
      }),
    },
    (error) => {
      throw error;
    },
  );
  const theme = new ThemeService(Base);
  app.provideContext(ASSETS_CONTEXT, assets);
  app.provideContext(THEME_CONTEXT, theme);
  app.scope.own(() => assets.dispose());
  app.scope.own(() => theme.dispose());
  const engine = new Engine(),
    scenes = new SceneManager(engine);
  page.scope.own(() => engine.dispose());
  const shared = page.resolve('stores', Game);
  const pageCoin = await theme.forOwner(page, Base).load('coin');
  let loading!: Promise<[AssetGroupLease<typeof Group.entries>, ThemeImageLease]>;
  let access: ReturnType<typeof createGameSceneAccess> | undefined;
  const live = defineGameScene({
    id: 'load-scene',
    setup(context) {
      assert.equal(context.useStore(Game), shared);
      context.useStore(Game).actions.setCount(4);
      assert.equal(context.useTheme(Base).resolve('coin').src, '/coin.png');
      loading = Promise.all([context.assets.load(Group), context.useTheme(Base).load('coin')]);
    },
  });
  const empty = defineGameScene({ id: 'empty', setup() {} });
  const services = (scope: Scope) => {
    access = createGameSceneAccess(page, scope);
    const current = access;
    return {
      get assets() {
        return current.assets;
      },
      useStore: current.useStore,
      useTheme: current.useTheme,
      readActions: () => neutral,
    };
  };
  try {
    await scenes.switchTo(adaptGameScene(live, {}, (core) => services(core.scope)));
    const sceneAccess = access!;
    const [lease, coin] = await loading;
    assert.equal(shared.state.count(), 4);
    assert.equal(coin.image.source, pageCoin.image.source);
    assert.deepEqual(calls.sort(), ['/coin.png', '/scene.png']);
    await scenes.switchTo(adaptGameScene(empty, {}, (core) => services(core.scope)));
    await settle();
    assert.deepEqual(released, ['/scene.png']);
    assert.throws(() => lease.get('image'), /released/);
    assert.throws(() => coin.image, /released/);
    assert.throws(() => sceneAccess.useStore(Game), /disposed/);
    assert.equal(pageCoin.image.width, 16);
    assert.equal(shared.state.count(), 4);
    assert.equal(page.resolve('stores', Game), shared);
    pageCoin.release();
    await settle();
    assert.deepEqual(released.sort(), ['/coin.png', '/scene.png']);
  } finally {
    app.dispose();
  }
});

test('scene scope cancellation rejects pending leases and returns ignored late image once', async () => {
  const { app, page } = owners();
  let finish!: (value: ReturnType<typeof image>) => void,
    released = 0;
  const assets = new AssetService(
    {
      transport: () => ({
        load: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        release() {
          released++;
        },
      }),
    },
    (error) => {
      throw error;
    },
  );
  app.provideContext(ASSETS_CONTEXT, assets);
  app.scope.own(() => assets.dispose());
  const scope = new Scope(),
    access = createGameSceneAccess(page, scope);
  const pending = access.assets.load(Group).then(
    () => false,
    () => true,
  );
  scope.dispose();
  assert.equal(await pending, true);
  finish(image());
  await settle();
  assert.equal(released, 1);
  assert.throws(() => access.assets, /disposed/);
  app.dispose();
  assert.equal(released, 1);
});

test('optional providers are lazy and parent exit invalidates an independently owned scene scope', async () => {
  const { app, page } = owners();
  const engine = new Engine(),
    scenes = new SceneManager(engine);
  const logic = defineGameScene({
    id: 'pure-logic',
    setup(context) {
      context.create();
    },
  });
  try {
    await scenes.switchTo(
      adaptGameScene(logic, {}, (core) => {
        const access = createGameSceneAccess(page, core.scope);
        return {
          get assets() {
            return access.assets;
          },
          useStore: access.useStore,
          useTheme: access.useTheme,
          readActions: () => neutral,
        };
      }),
    );
    assert.equal(engine.world.size, 1);
    const scope = new Scope(),
      access = createGameSceneAccess(page, scope);
    assert.equal(access.useStore(Game), page.resolve('stores', Game));
    page.dispose();
    assert.throws(() => access.useStore(Game), /disposed/);
    scope.dispose();
  } finally {
    engine.dispose();
    app.dispose();
  }
});
