import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  createMemoryHistoryDriver,
  defineApplication,
  defineComponent,
  RouterOutlet,
  mountApplication,
  nextTick,
  provideService,
  SaveService,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';
const settle = async () => {
  await nextTick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await nextTick();
};

test('result page shows completed runs, saves progress, loads across applications and ignores a read after leaving', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-result-'));
  try {
    const path = (file: string) =>
      JSON.stringify(relative(directory, resolve(file)).replaceAll('\\', '/'));
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export {AppRoutes} from ${path('templates/browser/src/app/app-routes.ts')};export {GameStore} from ${path('templates/browser/src/game/session/game-store.ts')};export {ProgressStore} from ${path('templates/browser/src/game/progress/progress-store.ts')};export {GameStorage} from ${path('templates/browser/src/game/preferences/settings-storage.ts')};`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'result.mjs' },
        rollupOptions: { external: (id) => id.startsWith('@xiaobaibaifqy/jingchuanchu-') },
      },
    });
    const module = (await import(
      pathToFileURL(join(output, 'result.mjs')).href
    )) as typeof import('../templates/browser/src/app/app-routes.js') &
      typeof import('../templates/browser/src/game/session/game-store.js') &
      typeof import('../templates/browser/src/game/progress/progress-store.js') &
      typeof import('../templates/browser/src/game/preferences/settings-storage.js');
    const Root = defineComponent({
      selector: 'result-test-root',
      components: [RouterOutlet],
      $template: '<router-outlet></router-outlet>',
      setup: (context) => ({
        game: context.useStore(module.GameStore),
        progress: context.useStore(module.ProgressStore),
      }),
    });
    const records = new Map<string, string>();
    let rejectWrite = false,
      rejectRead = false,
      delayRead = false;
    let releaseRead: ((raw: string | null) => void) | undefined;
    const definition = defineApplication({
      root: Root,
      routes: module.AppRoutes,
      providers: [
        provideService(
          module.GameStorage,
          () =>
            new SaveService({
              storage: {
                async get(key) {
                  if (rejectRead) throw new Error('denied');
                  if (delayRead)
                    return new Promise<string | null>((resolve) => {
                      releaseRead = resolve;
                    });
                  return records.get(key) ?? null;
                },
                async set(key, raw) {
                  if (rejectWrite) throw new Error('denied');
                  records.set(key, raw);
                },
                async remove(key) {
                  records.delete(key);
                },
              },
            }),
        ),
      ],
      router: { history: () => createMemoryHistoryDriver('/result') },
    });
    const window = new Window(),
      document = window.document as unknown as Document;
    const host = document.createElement('div');
    const app = await mountApplication(host, definition),
      { game, progress } = app.root.exposed;
    const click = async (selector: string) => {
      host.querySelector<HTMLButtonElement>(selector)!.click();
      await settle();
    };
    const status = () => host.querySelector('.progress-status')!.textContent!;
    assert.ok(host.querySelector('.no-result'));
    assert.equal(host.querySelector('canvas'), null);
    await click('.load-progress');
    assert.match(status(), /尚无/);
    const run = game.actions.beginRun('meadow');
    for (let i = 0; i < 8; i++) game.actions.collect(run);
    assert.equal(game.actions.finishRun(run, 'cleared'), true);
    game.actions.endRun(run);
    await settle();
    assert.match(host.querySelector('.run-result')!.textContent!, /收集完成/);
    assert.match(host.querySelector('.run-result')!.textContent!, /8 枚/);
    assert.equal(host.querySelector('.run-result a')!.getAttribute('href'), '/play/meadow');
    assert.deepEqual(progress.state.levels().meadow, { bestScore: 8, completed: true });
    assert.equal(game.actions.finishRun(run, 'timeout'), false);
    await click('.save-progress');
    assert.match(status(), /已保存/);
    const [key, raw] = [...records][0]!;
    assert.deepEqual(Object.keys(JSON.parse(raw).data), ['meadow']);
    assert.equal(records.size, 1);
    const retry = game.actions.beginRun('meadow');
    game.actions.collect(retry);
    game.actions.finishRun(retry, 'timeout');
    game.actions.endRun(retry);
    await settle();
    assert.match(host.querySelector('.run-result')!.textContent!, /时间到了/);
    assert.match(host.querySelector('.run-result')!.textContent!, /1 枚/);
    assert.equal(progress.state.levels().meadow!.bestScore, 8);
    rejectWrite = true;
    await click('.save-progress');
    assert.match(status(), /保存失败/);
    assert.equal(records.get(key), raw);
    rejectWrite = false;
    for (const [broken, message] of [
      ['broken', /损坏/],
      [JSON.stringify({ schemaVersion: 9, data: {} }), /不兼容/],
    ] as const) {
      records.set(key, broken);
      await click('.load-progress');
      assert.match(status(), message);
      assert.equal(records.get(key), broken);
      assert.equal(progress.state.levels().meadow!.bestScore, 8);
    }
    rejectRead = true;
    await click('.load-progress');
    assert.match(status(), /读取失败/);
    rejectRead = false;
    records.set(key, raw);
    await app.router.push({ name: 'level-select' });
    assert.ok(host.querySelector('a[href="/result"]'));
    await app.router.push({ name: 'home' });
    assert.equal(host.querySelector('input')!.value, '旅行者');
    app.dispose();
    const otherHost = document.createElement('div'),
      other = await mountApplication(otherHost, definition);
    assert.deepEqual(other.root.exposed.progress.state.levels(), {});
    otherHost.querySelector<HTMLButtonElement>('.load-progress')!.click();
    await settle();
    assert.equal(other.root.exposed.progress.state.levels().meadow!.completed, true);
    assert.ok(otherHost.querySelector('.no-result'));
    assert.equal(other.root.exposed.game.state.phase(), 'idle');
    assert.match(otherHost.querySelector('.progress-records')!.textContent!, /8 枚微光 · 已通关/);
    other.root.exposed.progress.reset();
    delayRead = true;
    otherHost.querySelector<HTMLButtonElement>('.load-progress')!.click();
    await settle();
    await other.router.push({ name: 'home' });
    releaseRead!(raw);
    await settle();
    assert.deepEqual(other.root.exposed.progress.state.levels(), {});
    other.dispose();
    await window.happyDOM.abort();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
