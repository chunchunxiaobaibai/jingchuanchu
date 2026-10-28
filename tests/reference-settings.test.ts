import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  defineApplication,
  defineComponent,
  RouterOutlet,
  createMemoryHistoryDriver,
  mountApplication,
  nextTick,
  signal,
  provideService,
  SaveService,
  type StorageAdapter,
  type AudioState,
  type AudioPreferences,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';
const settle = async () => {
  await nextTick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await nextTick();
};

test('settings share preferences and explicitly save/load validated snapshots without overwriting edits or exited pages', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-settings-'));
  try {
    const path = (file: string) =>
      JSON.stringify(relative(directory, resolve(file)).replaceAll('\\', '/'));
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export {AppRoutes} from ${path('templates/browser/src/app/app-routes.ts')};export {GameStore} from ${path('templates/browser/src/game/session/game-store.ts')};export {PreferencesStore} from ${path('templates/browser/src/game/preferences/preferences-store.ts')};export {bindAudioPreferences} from ${path('templates/browser/src/app/audio-preferences.ts')};export {GameStorage} from ${path('templates/browser/src/game/preferences/settings-storage.ts')};`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'settings.mjs' },
        rollupOptions: { external: (id) => id.startsWith('@xiaobaibaifqy/jingchuanchu-') },
      },
    });
    const module = (await import(
      pathToFileURL(join(output, 'settings.mjs')).href
    )) as typeof import('../templates/browser/src/app/app-routes.js') &
      typeof import('../templates/browser/src/game/session/game-store.js') &
      typeof import('../templates/browser/src/game/preferences/preferences-store.js') &
      typeof import('../templates/browser/src/app/audio-preferences.js') &
      typeof import('../templates/browser/src/game/preferences/settings-storage.js');
    const Root = defineComponent({
      selector: 'settings-test-root',
      components: [RouterOutlet],
      $template: '<router-outlet></router-outlet>',
      setup(context) {
        return {
          game: context.useStore(module.GameStore),
          preferences: context.useStore(module.PreferencesStore),
        };
      },
    });
    const document = new Window().document as unknown as Document,
      host = document.createElement('div');
    const records = new Map<string, string>();
    let rejectRead = false,
      rejectWrite = false;
    let pendingRead: ((value: string | null) => void) | undefined;
    let delayRead = false;
    let pendingWrite: (() => void) | undefined;
    let delayWrite = false;
    const storage: StorageAdapter = {
      async get(key) {
        if (rejectRead) throw new Error('read denied');
        if (delayRead)
          return new Promise<string | null>((resolve) => {
            pendingRead = resolve;
          });
        return records.get(key) ?? null;
      },
      async set(key, value) {
        if (rejectWrite) throw new Error('write denied');
        if (delayWrite)
          await new Promise<void>((resolve) => {
            pendingWrite = resolve;
          });
        records.set(key, value);
      },
      async remove(key) {
        records.delete(key);
      },
    };
    const definition = defineApplication({
      providers: [provideService(module.GameStorage, () => new SaveService({ storage }))],
      root: Root,
      routes: module.AppRoutes,
      router: { history: () => createMemoryHistoryDriver('/') },
    });
    const app = await mountApplication(host, definition),
      { game, preferences } = app.root.exposed;
    module.bindAudioPreferences(preferences, undefined, app.root.owner.scope);
    await app.router.push({ name: 'settings' });
    await settle();
    assert.match(host.querySelector('.audio-status')!.textContent!, /尚未接入/);
    const name = host.querySelector<HTMLInputElement>('#settings-name')!;
    name.value = '  小旅人  ';
    name.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    await settle();
    host
      .querySelector('form')!
      .dispatchEvent(
        new document.defaultView!.Event('submit', { bubbles: true, cancelable: true }),
      );
    assert.equal(game.state.nickname(), '小旅人');
    const master = host.querySelector<HTMLInputElement>('#volume-master')!;
    master.value = '0.25';
    master.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    const muted = host.querySelector<HTMLInputElement>('.muted')!;
    muted.checked = true;
    muted.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    await settle();
    assert.equal(preferences.state.audio().volumes.master, 0.25);
    assert.equal(preferences.state.audio().muted, true);
    assert.equal(preferences.actions.setVolume('master', 2), false);
    assert.equal(preferences.state.audio().volumes.master, 0.25);
    const before = preferences.state.audio();
    assert.throws(() =>
      preferences.actions.restore({ volumes: { master: 2, music: 0, effects: 0 }, muted: false }),
    );
    assert.equal(preferences.state.audio(), before);
    const device = signal<AudioState>('locked'),
      received: AudioPreferences[] = [];
    const stop = module.bindAudioPreferences(
      preferences,
      {
        state: device,
        restorePreferences(value) {
          received.push(value);
        },
      },
      app.root.owner.scope,
    );
    await settle();
    assert.equal(received.length, 1);
    assert.equal(received[0]!.volumes.master, 0.25);
    assert.equal(preferences.state.binding(), 'applied');
    device.set('ready');
    await settle();
    assert.match(host.querySelector('.audio-status')!.textContent!, /服务已接收/);
    await app.router.push({ name: 'home' });
    assert.equal(host.querySelector('input')!.value, '小旅人');
    await app.router.push({ name: 'settings' });
    assert.equal(host.querySelector<HTMLInputElement>('#volume-master')!.value, '0.25');
    assert.equal(host.querySelector<HTMLInputElement>('.muted')!.checked, true);
    stop();
    preferences.actions.setVolume('music', 0.2);
    await settle();
    assert.equal(received.length, 1);
    assert.equal(preferences.state.binding(), 'unavailable');
    const stopFailure = module.bindAudioPreferences(
      preferences,
      {
        state: device,
        restorePreferences() {
          throw new Error('injected sink failure');
        },
      },
      app.root.owner.scope,
    );
    await settle();
    assert.equal(preferences.state.binding(), 'failed');
    assert.match(host.querySelector('.audio-status')!.textContent!, /应用失败/);
    stopFailure();
    let stopInside = () => {};
    stopInside = module.bindAudioPreferences(
      preferences,
      {
        state: device,
        restorePreferences() {
          stopInside();
        },
      },
      app.root.owner.scope,
    );
    await settle();
    assert.equal(preferences.state.binding(), 'unavailable');
    const click = async (selector: string) => {
      host.querySelector<HTMLButtonElement>(selector)!.click();
      await settle();
    };
    const status = () => host.querySelector('.storage-status')!.textContent!;
    await click('.load-settings');
    assert.match(status(), /尚无/);
    await click('.save-settings');
    assert.match(status(), /已保存/);
    assert.equal(records.size, 1);
    const [key, raw] = [...records][0]!;
    assert.deepEqual(JSON.parse(raw), {
      schemaVersion: 1,
      data: {
        nickname: '小旅人',
        audio: { muted: true, volumes: { master: 0.25, music: 0.2, effects: 0.8 } },
      },
    });
    game.actions.rename('新旅人');
    preferences.actions.setMuted(false);
    await click('.load-settings');
    assert.match(status(), /已读取/);
    assert.equal(game.state.nickname(), '小旅人');
    assert.equal(host.querySelector<HTMLInputElement>('#settings-name')!.value, '小旅人');
    assert.equal(preferences.state.audio().muted, true);
    for (const [broken, message] of [
      ['{broken', /损坏/],
      [JSON.stringify({ schemaVersion: 99, data: {} }), /不兼容/],
      [
        JSON.stringify({
          schemaVersion: 1,
          data: {
            nickname: '有效名',
            audio: { muted: false, volumes: { master: 2, music: 0, effects: 0 } },
          },
        }),
        /损坏/,
      ],
    ] as const) {
      records.set(key, broken);
      const audio = preferences.state.audio();
      await click('.load-settings');
      assert.match(status(), message);
      assert.equal(records.get(key), broken);
      assert.equal(game.state.nickname(), '小旅人');
      assert.equal(preferences.state.audio(), audio);
    }
    records.set(key, raw);
    rejectRead = true;
    await click('.load-settings');
    assert.match(status(), /读取失败/);
    rejectRead = false;
    rejectWrite = true;
    await click('.save-settings');
    assert.match(status(), /保存失败/);
    assert.equal(records.get(key), raw);
    rejectWrite = false;
    delayWrite = true;
    await click('.save-settings');
    preferences.actions.setVolume('effects', 0.4);
    pendingWrite!();
    await settle();
    assert.match(status(), /后续改动尚未保存/);
    assert.equal(JSON.parse(records.get(key)!).data.audio.volumes.effects, 0.8);
    delayWrite = false;
    delayRead = true;
    await click('.load-settings');
    const draft = host.querySelector<HTMLInputElement>('#settings-name')!;
    draft.value = '未确认草稿';
    draft.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    pendingRead!(raw);
    await settle();
    assert.match(status(), /未覆盖/);
    assert.equal(draft.value, '未确认草稿');
    assert.equal(game.state.nickname(), '小旅人');
    await click('.load-settings');
    preferences.actions.setVolume('effects', 0.1);
    pendingRead!(raw);
    await settle();
    assert.match(status(), /未覆盖/);
    assert.equal(preferences.state.audio().volumes.effects, 0.1);
    await click('.load-settings');
    await app.router.push({ name: 'home' });
    game.actions.rename('离页后的昵称');
    pendingRead!(raw);
    await settle();
    assert.equal(game.state.nickname(), '离页后的昵称');
    assert.equal(host.querySelector('input')!.value, '小旅人');
    app.dispose();
    delayRead = false;
    const otherHost = document.createElement('div');
    const other = await mountApplication(otherHost, definition);
    assert.equal(other.root.exposed.preferences.state.audio().volumes.master, 1);
    await other.router.push({ name: 'settings' });
    assert.equal(other.root.exposed.preferences.state.audio().volumes.master, 1);
    otherHost.querySelector<HTMLButtonElement>('.load-settings')!.click();
    await settle();
    assert.equal(other.root.exposed.preferences.state.audio().volumes.master, 0.25);
    assert.equal(other.root.exposed.game.state.nickname(), '小旅人');
    other.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
