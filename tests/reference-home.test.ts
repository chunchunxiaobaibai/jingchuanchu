import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  defineApplication,
  defineComponent,
  mountApplication,
  definePage,
  RouterOutlet,
  createMemoryHistoryDriver,
  nextTick,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { normalizePlayerName } from '../templates/browser/src/game/session/game-store.js';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

test('reference home edits a local draft, saves valid names into its application Store and restores them on page return', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-home-'));
  try {
    const specifier = (file: string) => relative(directory, resolve(file)).replaceAll('\\', '/');
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export {HomePage} from ${JSON.stringify(specifier('templates/browser/src/pages/home/home-page.ts'))}; export {GameStore} from ${JSON.stringify(specifier('templates/browser/src/game/session/game-store.ts'))};`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'home.mjs' },
        rollupOptions: {
          external: ['@xiaobaibaifqy/jingchuanchu-app/application'],
        },
      },
    });
    const module = (await import(
      pathToFileURL(join(output, 'home.mjs')).href
    )) as typeof import('../templates/browser/src/pages/home/home-page.js') &
      typeof import('../templates/browser/src/game/session/game-store.js');
    const Root = defineComponent({
      selector: 'home-test-shell',
      components: [RouterOutlet],
      $template: '<router-outlet></router-outlet>',
      setup(context) {
        return { game: context.useStore(module.GameStore) };
      },
    });
    const document = new Window().document as unknown as Document,
      host = document.createElement('div');
    const Away = definePage({ selector: 'away-page', $template: '<p>away</p>' });
    const definition = defineApplication({
      root: Root,
      routes: [
        { path: '/', page: module.HomePage },
        { name: 'settings', path: '/settings', page: Away },
        { name: 'level-select', path: '/away', page: Away },
      ],
      router: { history: () => createMemoryHistoryDriver('/') },
    });
    const app = await mountApplication(host, definition);
    const pageHost = host.querySelector<HTMLElement>('game-home-page')!;
    const input = pageHost.querySelector('input')!,
      form = pageHost.querySelector('form')!,
      button = pageHost.querySelector('button')!;
    await nextTick();
    assert.equal(button.disabled, true);
    input.value = '  小旅人  ';
    input.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    await nextTick();
    assert.equal(button.disabled, false);
    assert.match(pageHost.querySelector('.preview')!.textContent!, /小旅人/);
    assert.equal(app.root.exposed.game.state.nickname(), '旅行者');
    const submit = new document.defaultView!.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    await nextTick();
    assert.equal(submit.defaultPrevented, true);
    assert.equal(app.root.exposed.game.state.nickname(), '小旅人');
    assert.equal(app.root.exposed.game.actions.rename('x'.repeat(17)), false);
    assert.equal(app.root.exposed.game.state.nickname(), '小旅人');
    assert.equal(input.value, '小旅人');
    assert.equal(button.disabled, true);
    input.value = ' ';
    input.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    await nextTick();
    form.dispatchEvent(
      new document.defaultView!.Event('submit', { bubbles: true, cancelable: true }),
    );
    assert.equal(button.disabled, true);
    assert.equal(app.root.exposed.game.state.nickname(), '小旅人');
    assert.equal((await app.router.push('/away')).status, 'committed');
    assert.equal(host.querySelector('input'), null);
    assert.equal((await app.router.push('/')).status, 'committed');
    assert.equal(host.querySelector('input')!.value, '小旅人');
    app.dispose();
    const other = await mountApplication(document.createElement('div'), definition);
    assert.equal(other.root.exposed.game.state.nickname(), '旅行者');
    other.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('player-name normalization enforces one contract for the form and direct Store actions', () => {
  assert.equal(normalizePlayerName('  旅行者  '), '旅行者');
  assert.equal(normalizePlayerName(''), null);
  assert.equal(normalizePlayerName('x'.repeat(17)), null);
  assert.equal(normalizePlayerName('name\ninside'), null);
  assert.equal(normalizePlayerName('🌟'.repeat(16)), '🌟'.repeat(16));
});
