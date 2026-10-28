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
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

// Actual lazy routes/pages are compiled together so every page resolves the same Store token.
test('reference routes navigate from home to a parameterized preview, commit explicit level choices and preserve them on return', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-levels-'));
  try {
    const specifier = (file: string) => relative(directory, resolve(file)).replaceAll('\\', '/');
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export {AppRoutes} from ${JSON.stringify(specifier('templates/browser/src/app/app-routes.ts'))}; export {GameStore} from ${JSON.stringify(specifier('templates/browser/src/game/session/game-store.ts'))};`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'levels.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(
      pathToFileURL(join(output, 'levels.mjs')).href
    )) as typeof import('../templates/browser/src/app/app-routes.js') &
      typeof import('../templates/browser/src/game/session/game-store.js');
    const Root = defineComponent({
      selector: 'levels-test-shell',
      components: [RouterOutlet],
      $template: '<router-outlet></router-outlet>',
      setup(context) {
        return { game: context.useStore(module.GameStore) };
      },
    });
    const definition = defineApplication({
      root: Root,
      routes: module.AppRoutes,
      router: { history: () => createMemoryHistoryDriver('/') },
    });
    const document = new Window().document as unknown as Document,
      host = document.createElement('div');
    const app = await mountApplication(host, definition);
    const game = app.root.exposed.game;
    assert.equal(host.querySelector('a')!.getAttribute('href'), '/levels');
    game.actions.rename('小旅人');
    assert.equal((await app.router.push({ name: 'level-select' })).status, 'committed');
    await nextTick();
    assert.match(host.textContent!, /小旅人/);
    assert.equal(host.querySelectorAll('li').length, 3);
    assert.equal(host.querySelector('button')!.disabled, true);
    assert.equal(game.state.selectedLevelId(), null);
    const links = [...host.querySelectorAll('li a')].map((link) => link.getAttribute('href'));
    assert.ok(links.includes('/levels/river'));
    assert.equal(
      (await app.router.push({ name: 'level-preview', params: { levelId: 'river' } })).status,
      'committed',
    );
    await nextTick();
    assert.equal(app.router.current()?.params.levelId, 'river');
    assert.match(host.querySelector('.preview')!.textContent!, /溪畔微风/);
    assert.equal(game.state.selectedLevelId(), null);
    host.querySelector('button')!.click();
    await nextTick();
    assert.equal(game.state.selectedLevelId(), 'river');
    assert.ok(
      [...host.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/play/river'),
    );
    assert.equal(host.querySelector('button')!.disabled, true);
    // @ts-expect-error finite level IDs reject unknown values; runtime still validates JS callers
    assert.equal(game.actions.selectLevel('unknown'), false);
    assert.equal(game.state.selectedLevelId(), 'river');
    const invalid = await app.router.push('/levels/unknown');
    assert.equal(invalid.status, 'redirected');
    assert.equal(app.router.current()?.name, 'level-select');
    assert.equal(game.state.selectedLevelId(), 'river');
    await app.router.push({ name: 'home' });
    assert.equal(host.querySelector('input')!.value, '小旅人');
    await app.router.push({ name: 'level-select' });
    await nextTick();
    assert.match(host.querySelector('.selected')!.textContent!, /溪畔微风/);
    assert.equal(host.querySelector('canvas'), null);
    app.dispose();
    const other = await mountApplication(document.createElement('div'), definition);
    assert.equal(other.root.exposed.game.state.selectedLevelId(), null);
    other.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
