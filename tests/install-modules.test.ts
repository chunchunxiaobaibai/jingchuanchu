import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { addModules } from '../packages/tooling/install.mjs';
import { createProject } from '../packages/tooling/scaffold.mjs';
const prefix = '@xiaobaibaifqy/jingchuanchu-';
async function fixture(run: (project: string, bundle: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'jcc-add-'));
  try {
    const project = join(directory, 'project'),
      bundle = join(directory, 'bundle');
    await mkdir(project);
    await mkdir(join(bundle, 'packages'), { recursive: true });
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify(
        {
          name: 'consumer',
          private: true,
          dependencies: { 'existing-library': '^1.0.0' },
          devDependencies: { [prefix + 'core']: '^0.4.0' },
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(join(project, 'business.ts'), 'export const untouched = true;');
    await writeFile(join(project, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
    const dependencies: Record<string, Record<string, string>> = {
      ecs: {},
      core: { [prefix + 'ecs']: '^1.0.0' },
      assets: { [prefix + 'core']: '^1.0.0' },
      net: { [prefix + 'core']: '^1.0.0' },
      'net-server': { [prefix + 'net']: '^1.0.0' },
      tooling: { typescript: '^5.9.0' },
    };
    const packages = [];
    for (const [name, deps] of Object.entries(dependencies)) {
      // Deliberately simulated archive bytes: these tests verify planning/transactions, not npm installation.
      const bytes = Buffer.from('fixture archive: ' + name),
        file = name + '-1.0.0.tgz';
      await writeFile(join(bundle, 'packages', file), bytes);
      packages.push({
        name: prefix + name,
        version: '1.0.0',
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        dependencies: deps,
      });
    }
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ packages }));
    await run(project, bundle);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('add selects internal closure, writes relative vendor dependencies and records, preserves business/lockfile and is repeatable', async () =>
  fixture(async (project, bundle) => {
    const result = await addModules({ project, bundle, modules: 'assets,net' });
    assert.deepEqual(
      result.modules,
      ['assets', 'core', 'ecs', 'net'].map((name) => prefix + name),
    );
    const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['existing-library'], '^1.0.0');
    assert.equal(pkg.dependencies[prefix + 'core'], 'file:vendor/core-1.0.0.tgz');
    assert.equal(prefix + 'core' in pkg.devDependencies, false);
    assert.equal(
      await readFile(join(project, 'business.ts'), 'utf8'),
      'export const untouched = true;',
    );
    assert.equal(
      await readFile(join(project, 'package-lock.json'), 'utf8'),
      '{"lockfileVersion":3,"packages":{}}',
    );
    const records = JSON.parse(await readFile(join(project, 'jingchuanchu-packages.json'), 'utf8'));
    assert.equal(records.schemaVersion, 1);
    assert.equal(records.packages[prefix + 'assets'].file, 'vendor/assets-1.0.0.tgz');
    assert.equal((await readdir(join(project, 'vendor'))).length, 4);
    assert.deepEqual((await addModules({ project, bundle, modules: ['assets', 'net'] })).files, []);
    assert.equal(result.next, 'npm install');
  }));

test('CLI --all includes server/runtime modules and puts tooling only in development dependencies', async () =>
  fixture(async (project, bundle) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve('packages/tooling/cli.mjs'),
        'add',
        '--all',
        '--bundle',
        bundle,
        '--project',
        project,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not run automatically/);
    const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies[prefix + 'net-server']);
    assert.ok(pkg.devDependencies[prefix + 'tooling']);
    assert.equal(prefix + 'tooling' in pkg.dependencies, false);
    assert.equal((await readdir(join(project, 'vendor'))).length, 6);
    await assert.rejects(access(join(project, 'node_modules')));
  }));

test('digest failures, invalid selection and vendor conflicts leave the project unchanged', async () =>
  fixture(async (project, bundle) => {
    const before = await readFile(join(project, 'package.json'), 'utf8');
    await assert.rejects(addModules({ project, bundle, all: true, modules: ['net'] }), /OR --all/);
    await assert.rejects(
      addModules({ project, bundle, modules: ['missing'] }),
      /missing from bundle/,
    );
    await writeFile(join(bundle, 'packages/net-1.0.0.tgz'), 'tampered');
    await assert.rejects(addModules({ project, bundle, modules: ['net'] }), /Checksum mismatch/);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), before);
    await assert.rejects(access(join(project, 'vendor')));
    await mkdir(join(project, 'vendor'));
    await writeFile(join(project, 'vendor/core-1.0.0.tgz'), 'existing archive');
    await assert.rejects(addModules({ project, bundle, modules: ['core'] }), /conflicting vendor/);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), before);
    assert.equal(
      await readFile(join(project, 'vendor/core-1.0.0.tgz'), 'utf8'),
      'existing archive',
    );
  }));

test('a read-only package manifest failure rolls back only newly added vendor files and package records', async (context) => {
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    context.skip('root bypasses file write permissions');
    return;
  }
  await fixture(async (project, bundle) => {
    const file = join(project, 'package.json'),
      before = await readFile(file, 'utf8');
    await chmod(file, 0o444);
    try {
      await assert.rejects(
        addModules({ project, bundle, modules: ['assets'] }),
        /EACCES|EPERM|permission|denied/i,
      );
      assert.equal(await readFile(file, 'utf8'), before);
      await assert.rejects(access(join(project, 'vendor')));
      await assert.rejects(access(join(project, 'jingchuanchu-packages.json')));
    } finally {
      await chmod(file, 0o666);
    }
  });
});

test('create reuses the shared planner without accidentally selecting every bundle module', async () =>
  fixture(async (project, bundle) => {
    const target = join(project, 'core-consumer');
    await createProject(target, { preset: 'core', bundle });
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.deepEqual(
      Object.keys(pkg.dependencies).sort(),
      [prefix + 'core', prefix + 'ecs'].sort(),
    );
    assert.equal(prefix + 'tooling' in pkg.devDependencies, false);
    assert.equal((await readdir(join(target, 'vendor'))).length, 2);
  }));
