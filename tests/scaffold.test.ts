import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  access,
  chmod,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRouteMatcher } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { tmpdir } from 'node:os';
import { generate } from '../packages/tooling/scaffold.mjs';
import { compileViews } from '../packages/tooling/compiler.mjs';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const root = await mkdtemp(resolve('dist/audit/scaffold-'));
  try {
    await writeFile(
      join(root, 'jingchuanchu.json'),
      JSON.stringify({
        schemaVersion: 2,
        profile: 'application',
        style: 'less',
        paths: { components: 'features/widgets', pages: 'features/screens' },
      }),
    );
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(join(root, 'src/app/app-shell.ts'), 'export const AppShell = {};');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('shared components follow configured paths, compile as new components and never auto-mount', async () =>
  fixture(async (root) => {
    const files = await generate('component', 'icon-button', { project: root, shared: true });
    const base = join(root, 'features/widgets/icon-button/icon-button');
    assert.deepEqual(files, [base + '.ts', base + '.html', base + '.less']);
    const source = await readFile(base + '.ts', 'utf8');
    assert.match(source, /export const IconButton = defineComponent/);
    const compiled = await compileViews(source, base + '.ts');
    assert.ok(compiled?.code.includes('$template:'));
    assert.equal(
      await readFile(join(root, 'src/app/app-shell.ts'), 'utf8'),
      'export const AppShell = {};',
    );
    await assert.rejects(access(join(root, 'src/account')));
  }));

test('page-private components stay beside their page and preserve its original files', async () =>
  fixture(async (root) => {
    const page = join(root, 'features/screens/play/play-page.ts');
    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, 'export const PlayPage = {};');
    const files = await generate('component', 'hud', { project: root, page: 'play', style: 'css' });
    assert.ok(files.every((file) => file.startsWith(join(root, 'features/screens/play/hud'))));
    assert.ok(files.some((file) => file.endsWith('hud.css')));
    assert.equal(await readFile(page, 'utf8'), 'export const PlayPage = {};');
    await assert.rejects(
      generate('component', 'other', { project: root, page: 'missing' }),
      /Page does not exist/,
    );
  }));

test('scope/filename/style conflicts are rejected before creating partial component files', async () =>
  fixture(async (root) => {
    await assert.rejects(generate('component', 'hud', { project: root }), /exactly one/);
    await assert.rejects(
      generate('component', 'hud', { project: root, shared: true, page: 'play' }),
      /exactly one/,
    );
    await assert.rejects(generate('view', 'hud', { project: root }), /legacy view\/scene/);
    await assert.rejects(
      generate('component', '../escape', { project: root, shared: true }),
      /kebab/,
    );
    const directory = join(root, 'features/widgets/hud');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'hud.css'), 'existing CSS');
    await assert.rejects(
      generate('component', 'hud', { project: root, shared: true }),
      /overwrite/,
    );
    assert.deepEqual(await readdir(directory), ['hud.css']);
    assert.equal(await readFile(join(directory, 'hud.css'), 'utf8'), 'existing CSS');
  }));

test('nested output junctions cannot send generated component files outside the project', async () =>
  fixture(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), 'jcc-scaffold-outside-'));
    try {
      await mkdir(join(root, 'features/widgets'), { recursive: true });
      await symlink(outside, join(root, 'features/widgets/hud'), 'junction');
      await assert.rejects(
        generate('component', 'hud', { project: root, shared: true }),
        /escapes project root/,
      );
      assert.deepEqual(await readdir(outside), []);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));

test('CLI accepts the explicit shared flag and per-component CSS override', async () =>
  fixture(async (root) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve('packages/tooling/cli.mjs'),
        'generate',
        'component',
        'badge',
        '--project',
        root,
        '--shared',
        '--style',
        'css',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /badge.css/);
    const base = join(root, 'features/widgets/badge/badge');
    assert.ok(await compileViews(await readFile(base + '.ts', 'utf8'), base + '.ts'));
  }));

async function routeFile(
  root: string,
  source = "import {defineRoutes as routes} from '@xiaobaibaifqy/jingchuanchu-app/application';\nconst entries = [/* existing route comments */] as const;\nexport const AppRoutes = routes(entries);\n",
) {
  const file = join(root, 'src/app/app-routes.ts');
  await writeFile(file, source);
  return file;
}

test('pages generate hyphenated three-file entries and register lazy routes through imported aliases/static arrays', async () =>
  fixture(async (root) => {
    const registry = await routeFile(root);
    const files = await generate('page', 'play', { project: root, route: '/play/:levelId' });
    const base = join(root, 'features/screens/play/play-page');
    assert.deepEqual(files, [base + '.ts', base + '.html', base + '.less', registry]);
    assert.ok(await compileViews(await readFile(base + '.ts', 'utf8'), base + '.ts'));
    const source = await readFile(registry, 'utf8');
    assert.match(source, /existing route comments/);
    assert.match(source, /import\("..\/..\/features\/screens\/play\/play-page.js"\)/);
    assert.match(source, /module.PlayPage/);
    const module = await import(pathToFileURL(registry).href);
    const location = createRouteMatcher(module.AppRoutes).resolve('/play/one%2Ftwo');
    assert.equal(location.name, 'play');
    assert.equal(location.params.levelId, 'one/two');
  }));

test('nested route name/pattern conflicts refuse all page writes and preserve the registry', async () =>
  fixture(async (root) => {
    const before =
      "import {defineRoutes} from '@xiaobaibaifqy/jingchuanchu-app/application'; export const Routes = defineRoutes([{path:'/',loadPage:async()=>unknownPage,children:[{name:'existing',path:'play/:id',loadPage:async()=>unknownPage}]}]);";
    const registry = await routeFile(root, before);
    await assert.rejects(
      generate('page', 'play', { project: root, route: '/play/:levelId' }),
      /conflicts/,
    );
    await assert.rejects(
      generate('page', 'existing', { project: root, route: '/other' }),
      /conflicts/,
    );
    await assert.rejects(access(join(root, 'features/screens')));
    assert.equal(await readFile(registry, 'utf8'), before);
  }));

test('dynamic/spoofed registries give manual integration instructions without writing page files', async () =>
  fixture(async (root) => {
    for (const before of [
      "import {defineRoutes} from '@xiaobaibaifqy/jingchuanchu-app/application'; export const Routes=defineRoutes(getRoutes());",
      "import {defineRoutes} from './business.js'; export const Routes=defineRoutes([]);",
    ]) {
      const registry = await routeFile(root, before);
      await assert.rejects(
        generate('page', 'play', { project: root, route: '/play' }),
        /app-routes.ts:.*Manually add/,
      );
      await assert.rejects(access(join(root, 'features/screens')));
      assert.equal(await readFile(registry, 'utf8'), before);
    }
  }));

test('page file conflicts are preflighted before changing the application route array', async () =>
  fixture(async (root) => {
    const registry = await routeFile(root),
      before = await readFile(registry, 'utf8');
    const directory = join(root, 'features/screens/play');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'play-page.css'), 'existing stylesheet');
    await assert.rejects(generate('page', 'play', { project: root, route: '/play' }), /overwrite/);
    assert.deepEqual(await readdir(directory), ['play-page.css']);
    assert.equal(await readFile(registry, 'utf8'), before);
  }));

test('CLI page generation accepts explicit route parameters', async () =>
  fixture(async (root) => {
    const registry = await routeFile(root);
    const result = spawnSync(
      process.execPath,
      [
        resolve('packages/tooling/cli.mjs'),
        'generate',
        'page',
        'level-select',
        '--project',
        root,
        '--route',
        '/levels/:chapterId',
        '--style',
        'css',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /level-select-page.css/);
    assert.match(await readFile(registry, 'utf8'), /module.LevelSelectPage/);
  }));

test('a read-only registry write failure removes the new page files and preserves original routes', async (context) => {
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    context.skip('root bypasses file write permissions');
    return;
  }
  await fixture(async (root) => {
    const registry = await routeFile(root),
      before = await readFile(registry, 'utf8');
    await chmod(registry, 0o444);
    try {
      await assert.rejects(
        generate('page', 'play', { project: root, route: '/play' }),
        /EACCES|EPERM|permission|denied/i,
      );
      assert.equal(await readFile(registry, 'utf8'), before);
      await assert.rejects(access(join(root, 'features/screens/play/play-page.ts')));
      await assert.rejects(access(join(root, 'features/screens')));
    } finally {
      await chmod(registry, 0o666);
    }
  });
});
