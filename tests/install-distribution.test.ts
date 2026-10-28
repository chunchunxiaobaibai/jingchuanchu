import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { addModules } from '../packages/tooling/install.mjs';
const prefix = '@xiaobaibaifqy/jingchuanchu-';
// Local fixture packages only. Actual engine application/tooling archive consumption is T36.
const modules: Record<string, { dependencies: Record<string, string>; source: string }> = {
  ecs: { dependencies: {}, source: "export const ecs = 'ecs';" },
  core: {
    dependencies: { [prefix + 'ecs']: '^1.0.0' },
    source: `import {ecs} from '${prefix}ecs'; export const core = ecs + '/core';`,
  },
  assets: {
    dependencies: { [prefix + 'core']: '^1.0.0' },
    source: `import {core} from '${prefix}core'; export const assets = core + '/assets';`,
  },
  net: {
    dependencies: { [prefix + 'core']: '^1.0.0' },
    source: `import {core} from '${prefix}core'; export const net = core + '/net';`,
  },
  'net-server': {
    dependencies: { [prefix + 'net']: '^1.0.0' },
    source: `import {net} from '${prefix}net'; export const server = net + '/server';`,
  },
  tooling: { dependencies: {}, source: "export const tooling = 'fixture-tooling';" },
};
function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 45_000 });
  assert.equal(
    result.status,
    0,
    `${args[0]}: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

test('actual tgz add selections install and relocated vendor/lockfiles support offline npm ci with an empty cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jcc-install-distribution-'));
  try {
    const npm = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await access(npm);
    const bundle = join(root, 'bundle'),
      archives = join(bundle, 'packages'),
      packages = [];
    await mkdir(archives, { recursive: true });
    for (const [name, module] of Object.entries(modules)) {
      const directory = join(root, 'sources', name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: prefix + name,
          version: '1.0.0',
          type: 'module',
          exports: './index.js',
          files: ['index.js'],
          dependencies: module.dependencies,
          scripts: { postinstall: 'node -e "process.exit(91)"' },
        }),
      );
      await writeFile(join(directory, 'index.js'), module.source);
      const output = JSON.parse(
        run(
          [
            npm,
            'pack',
            '--offline',
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            archives,
            '--cache',
            join(root, 'pack-cache'),
          ],
          directory,
        ),
      ) as { filename: string }[];
      const file = output[0]!.filename,
        bytes = await readFile(join(archives, file));
      packages.push({
        name: prefix + name,
        version: '1.0.0',
        file,
        dependencies: module.dependencies,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ packages }));
    for (const all of [false, true]) {
      const name = all ? 'all' : 'selected',
        project = join(root, name);
      await mkdir(project);
      await writeFile(
        join(project, 'package.json'),
        JSON.stringify({ name: 'fixture-consumer-' + name, private: true, type: 'module' }),
      );
      await addModules(
        all ? { project, bundle, all: true } : { project, bundle, modules: ['assets', 'net'] },
      );
      run(
        [
          npm,
          'install',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--cache',
          join(root, 'install-cache-' + name),
        ],
        project,
      );
      const lockText = await readFile(join(project, 'package-lock.json'), 'utf8');
      const lock = JSON.parse(lockText) as { packages: Record<string, { resolved?: string }> };
      for (const [key, value] of Object.entries(lock.packages))
        if (key.startsWith('node_modules/' + prefix))
          assert.match(value.resolved!, /^file:vendor\/[^/]+\.tgz$/);
      const relocated = join(root, 'relocated-' + name);
      await mkdir(relocated);
      for (const file of ['package.json', 'package-lock.json', 'vendor'])
        await cp(join(project, file), join(relocated, file), { recursive: true });
      // npm --offline plus a new empty cache forces every fixture dependency to come from vendor.
      run(
        [
          npm,
          'ci',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--cache',
          join(root, 'empty-relocated-cache-' + name),
        ],
        relocated,
      );
      const source = `import {assets} from '${prefix}assets'; import {net} from '${prefix}net'; console.log(assets + '|' + net);`;
      assert.equal(
        run(['--input-type=module', '-e', source], relocated).trim(),
        'ecs/core/assets|ecs/core/net',
      );
      if (all) {
        const pkg = JSON.parse(await readFile(join(relocated, 'package.json'), 'utf8'));
        assert.ok(pkg.devDependencies[prefix + 'tooling']);
        assert.ok(pkg.dependencies[prefix + 'net-server']);
        assert.equal(
          run(
            [
              '--input-type=module',
              '-e',
              `import {server} from '${prefix}net-server'; import {tooling} from '${prefix}tooling'; console.log(server + '|' + tooling);`,
            ],
            relocated,
          ).trim(),
          'ecs/core/net/server|fixture-tooling',
        );
      }
      assert.equal(await readFile(join(relocated, 'package-lock.json'), 'utf8'), lockText);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
