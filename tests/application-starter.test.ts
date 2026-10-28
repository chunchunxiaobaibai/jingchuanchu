import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { createProject, generate } from '../packages/tooling/scaffold.mjs';
import { loadProjectConfig } from '../packages/tooling/project-config.mjs';
import { jingchuanchu } from '../packages/tooling/vite.mjs';
async function workspace(run: (container: string) => Promise<void>) {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const container = await mkdtemp(resolve('dist/audit/application-starter-'));
  try {
    await run(container);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

test('new CSS/Less browser starters generate pages/components and pass source-based CLI/type checks; Less produces lazy chunks', async () =>
  workspace(async (container) => {
    for (const [preset, style] of [
      ['singleplayer', 'css'],
      ['client', 'less'],
    ] as const) {
      const root = join(container, preset);
      await createProject(root, { preset, style });
      for (const file of [
        'src/assets/audio/collect.wav',
        'src/assets/audio/complete.wav',
        'src/assets/audio/timeout.wav',
        'src/themes/dusk/assets/star.svg',
        'public/theme-assets-license.txt',
      ])
        assert.deepEqual(
          await readFile(join(root, file)),
          await readFile(resolve('templates/browser', file)),
        );
      await access(join(root, 'src/pages/play/play-scene.ts'));
      await access(join(root, 'src/pages/result/result-page.html'));
      await access(join(root, 'scripts/generate-audio.mjs'));
      if (style === 'less') {
        await access(join(root, 'src/pages/play/play-page.less'));
        await assert.rejects(access(join(root, 'src/pages/play/play-page.css')));
        assert.match(await readFile(join(root, 'src/main.ts'), 'utf8'), /base\.less/);
      }
      const config = await loadProjectConfig(root);
      assert.equal(config.profile, 'application');
      assert.equal(config.schemaVersion, 2);
      await assert.rejects(access(join(root, 'src/account')));
      await assert.rejects(access(join(root, 'src/ui')));
      await assert.rejects(
        generate('page', 'play', { project: root, route: '/bonus' }),
        /conflicts|overwrite/,
      );
      await generate('page', 'bonus', { project: root, route: '/bonus' });
      await generate('component', 'score-panel', { project: root, page: 'bonus' });
      await generate('component', 'icon-button', { project: root, shared: true });
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      assert.ok(pkg.devDependencies['@xiaobaibaifqy/jingchuanchu-tooling']);
      assert.equal('@xiaobaibaifqy/jingchuanchu-tooling' in pkg.dependencies, false);
      assert.equal('@xiaobaibaifqy/jingchuanchu-net' in pkg.dependencies, preset === 'client');
      // Repository verification only: published application entry packaging belongs to T36.
      const tsconfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
      assert.equal('customConditions' in tsconfig.compilerOptions, false);
      tsconfig.compilerOptions.customConditions = ['source'];
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
      const cli = spawnSync(
        process.execPath,
        [resolve('packages/tooling/cli.mjs'), 'check', root],
        { encoding: 'utf8' },
      );
      assert.equal(cli.status, 0, cli.stderr);
      const typed = spawnSync(
        process.execPath,
        [resolve('node_modules/typescript/bin/tsc'), '-p', root, '--noEmit'],
        { encoding: 'utf8' },
      );
      assert.equal(typed.status, 0, typed.stdout + typed.stderr);
      await assert.rejects(createProject(root), /empty/);
      if (style === 'less') {
        const result = await build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [jingchuanchu()],
          resolve: { conditions: ['source'] },
          build: { write: false },
        });
        const bundles = Array.isArray(result) ? result : [result];
        const chunks = bundles
          .flatMap((item) => ('output' in item ? item.output : []))
          .filter((item) => item.type === 'chunk');
        assert.ok(chunks.filter((item) => item.isDynamicEntry).length >= 2);
      }
    }
  }));

test('core/server keep non-UI presets and explicit legacy browser creation still uses the old model', async () =>
  workspace(async (container) => {
    for (const preset of ['core', 'server'] as const) {
      const root = join(container, preset);
      await createProject(root, { preset });
      assert.equal((await loadProjectConfig(root)).profile, 'legacy-v0.4');
      await assert.rejects(access(join(root, 'src/pages')));
      await assert.rejects(
        createProject(join(container, preset + '-invalid'), { preset, profile: 'application' }),
        /non-UI/,
      );
    }
    const cliRoot = join(container, 'cli');
    const cli = spawnSync(
      process.execPath,
      [
        resolve('packages/tooling/cli.mjs'),
        'create',
        cliRoot,
        '--preset',
        'singleplayer',
        '--style',
        'css',
        '--profile',
        'application',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal((await loadProjectConfig(cliRoot)).profile, 'application');
    const root = join(container, 'legacy');
    await createProject(root, { profile: 'legacy-v0.4' });
    assert.equal((await loadProjectConfig(root)).profile, 'legacy-v0.4');
    await access(join(root, 'src/ui/components/GameApp/GameApp.ts'));
  }));
