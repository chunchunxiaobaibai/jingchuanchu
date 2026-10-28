import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Window } from 'happy-dom';
import {
  defineComponent,
  defineApplication,
  mountApplication,
  type StoreDefinition,
  type WritableSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createProject, generate } from '../packages/tooling/scaffold.mjs';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const container = await mkdtemp(resolve('dist/audit/domain-scaffold-'));
  try {
    const root = join(container, 'game');
    await createProject(root);
    await generate('page', 'bonus', { project: root, route: '/bonus' });
    await run(root);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

test('scene/store/theme definitions execute through actual APIs and remain explicit application capabilities', async () =>
  fixture(async (root) => {
    const appFile = join(root, 'src/app/app-config.ts'),
      before = await readFile(appFile, 'utf8');
    const pageFile = join(root, 'src/pages/bonus/bonus-page.ts'),
      pageBefore = await readFile(pageFile, 'utf8');
    const [sceneFile] = await generate('scene', 'bonus', { project: root, page: 'bonus' });
    const [storeFile] = await generate('store', 'score', { project: root, domain: 'session' });
    const [baseFile] = await generate('theme', 'custom', { project: root });
    const [themeFile] = await generate('theme', 'forest', { project: root, extends: 'custom' });
    assert.equal(sceneFile, join(root, 'src/pages/bonus/bonus-scene.ts'));
    assert.equal(storeFile, join(root, 'src/game/session/score-store.ts'));
    const scene = (await import(pathToFileURL(sceneFile!).href)).BonusScene;
    assert.equal(scene.id, 'bonus/bonus');
    assert.equal(typeof scene.setup, 'function');
    const ScoreStore: StoreDefinition<
      { count: WritableSignal<number> },
      {},
      { increment(): void }
    > = (await import(pathToFileURL(storeFile!).href)).ScoreStore;
    const Root = defineComponent({
      selector: 'generated-store-host',
      $template: '<p>game</p>',
      setup(context) {
        return { game: context.useStore(ScoreStore) };
      },
    });
    const document = new Window().document as unknown as Document;
    const app = await mountApplication(
      document.createElement('div'),
      defineApplication({ root: Root }),
    );
    app.root.exposed.game.actions.increment();
    assert.equal(app.root.exposed.game.state.count(), 1);
    app.root.exposed.game.reset();
    assert.equal(app.root.exposed.game.state.count(), 0);
    app.dispose();
    const base = (await import(pathToFileURL(baseFile!).href)).CustomTheme;
    const theme = (await import(pathToFileURL(themeFile!).href)).ForestTheme;
    assert.equal(theme.name, 'forest');
    assert.deepEqual({ ...theme.tokens }, { ...base.tokens });
    assert.equal(await readFile(appFile, 'utf8'), before);
    assert.equal(await readFile(pageFile, 'utf8'), pageBefore);
    const tsconfigFile = join(root, 'tsconfig.json'),
      config = JSON.parse(await readFile(tsconfigFile, 'utf8'));
    config.compilerOptions.customConditions = ['source'];
    await writeFile(tsconfigFile, JSON.stringify(config));
    const checked = spawnSync(
      process.execPath,
      [resolve('packages/tooling/cli.mjs'), 'check', root],
      { encoding: 'utf8' },
    );
    assert.equal(checked.status, 0, checked.stderr);
    const typed = spawnSync(
      process.execPath,
      [resolve('node_modules/typescript/bin/tsc'), '-p', root, '--noEmit'],
      { encoding: 'utf8' },
    );
    assert.equal(typed.status, 0, typed.stdout + typed.stderr);
  }));

test('required scopes and valid theme ancestry are preflighted without changing existing definitions', async () =>
  fixture(async (root) => {
    await assert.rejects(generate('scene', 'bonus', { project: root }), /requires --page/);
    await assert.rejects(
      generate('scene', 'bonus', { project: root, page: 'missing' }),
      /Page does not exist/,
    );
    await assert.rejects(generate('store', 'score', { project: root }), /requires --domain/);
    await assert.rejects(
      generate('theme', 'forest', { project: root, extends: 'forest' }),
      /itself/,
    );
    await assert.rejects(
      generate('theme', 'forest', { project: root, extends: 'missing' }),
      /Base theme requires/,
    );
    await assert.rejects(access(join(root, 'src/themes/forest')));
    const [file] = await generate('scene', 'bonus', { project: root, page: 'bonus' });
    const before = await readFile(file!, 'utf8');
    await assert.rejects(generate('scene', 'bonus', { project: root, page: 'bonus' }), /overwrite/);
    assert.equal(await readFile(file!, 'utf8'), before);
    assert.deepEqual((await readdir(join(root, 'src/pages/bonus'))).sort(), [
      'bonus-page.css',
      'bonus-page.html',
      'bonus-page.ts',
      'bonus-scene.ts',
    ]);
  }));

test('CLI domain/extends flags reach generators and irrelevant flags cannot silently change scope', async () =>
  fixture(async (root) => {
    await generate('theme', 'custom', { project: root });
    for (const args of [
      ['store', 'settings', '--domain', 'preferences'],
      ['theme', 'night', '--extends', 'custom'],
    ]) {
      const result = spawnSync(
        process.execPath,
        [resolve('packages/tooling/cli.mjs'), 'generate', ...args, '--project', root],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
    }
    await assert.rejects(
      generate('store', 'bad', { project: root, domain: 'session', page: 'bonus' }),
      /does not accept --page/,
    );
    await assert.rejects(
      generate('scene', 'bad', { project: root, page: 'bonus', style: 'less' }),
      /does not accept --style/,
    );
  }));
