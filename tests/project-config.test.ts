import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProjectConfig, ProjectConfigError } from '../packages/tooling/project-config.mjs';
async function project(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jcc-config-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/main.ts'), 'export {};');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const current = { schemaVersion: 2, profile: 'application', preset: 'singleplayer', style: 'less' };
async function config(root: string, value: unknown) {
  await writeFile(join(root, 'jingchuanchu.json'), JSON.stringify(value));
}

test('missing and v0.4 configurations resolve as legacy without migration or optional directories', async () =>
  project(async (root) => {
    assert.equal((await loadProjectConfig(root)).profile, 'legacy-v0.4');
    const old = { preset: 'client', style: 'css' };
    await config(root, old);
    const resolved = await loadProjectConfig(root);
    assert.equal(resolved.schemaVersion, 1);
    assert.equal(resolved.profile, 'legacy-v0.4');
    assert.deepEqual(resolved.paths, {});
    assert.deepEqual(JSON.parse(await readFile(join(root, 'jingchuanchu.json'), 'utf8')), old);
    await assert.rejects(access(join(root, 'src/account')));
  }));

test('application paths use defaults and explicit overrides, are normalized and readonly', async () =>
  project(async (root) => {
    await config(root, {
      ...current,
      paths: { pages: './features/game-pages/', components: 'features\\widgets' },
    });
    const resolved = await loadProjectConfig(root);
    assert.equal(resolved.profile, 'application');
    assert.equal(resolved.style, 'less');
    assert.equal(resolved.paths.app, 'src/app');
    assert.equal(resolved.paths.pages, 'features/game-pages');
    assert.equal(resolved.paths.components, 'features/widgets');
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(Object.isFrozen(resolved.paths), true);
    await assert.rejects(access(join(root, 'features')));
  }));

test('unsupported schemas/profiles and invalid fields report configuration provenance', async () =>
  project(async (root) => {
    for (const value of [
      { ...current, schemaVersion: 3 },
      { schemaVersion: 2 },
      { ...current, profile: 'other' },
      { ...current, style: 'sass' },
      { ...current, preset: 'other' },
      { ...current, paths: [] },
      { ...current, paths: { unknown: 'src/unknown' } },
    ]) {
      await config(root, value);
      await assert.rejects(
        loadProjectConfig(root),
        (error) =>
          error instanceof ProjectConfigError && error.file === join(root, 'jingchuanchu.json'),
      );
    }
    await writeFile(join(root, 'jingchuanchu.json'), '{broken');
    await assert.rejects(
      loadProjectConfig(root),
      (error) => error instanceof ProjectConfigError && error.field === 'json',
    );
  }));

test('absolute, traversing, overlapping and symlink-escaping generation paths are rejected', async () =>
  project(async (root) => {
    for (const pages of [
      '../outside',
      'src/../pages',
      '/outside',
      'D:\\outside',
      'D:outside',
      '\\\\host\\share',
      '.',
      'src/app/nested',
    ]) {
      await config(root, { ...current, paths: { pages } });
      await assert.rejects(loadProjectConfig(root), ProjectConfigError, pages);
    }
    const outside = await mkdtemp(join(tmpdir(), 'jcc-config-outside-'));
    try {
      await symlink(outside, join(root, 'external'), 'junction');
      await config(root, { ...current, paths: { pages: 'external/new-pages' } });
      await assert.rejects(loadProjectConfig(root), /symbolic links/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));

test('CLI check validates the selected profile and never applies application defaults to legacy projects', async () =>
  project(async (root) => {
    const check = () =>
      spawnSync(process.execPath, [resolve('packages/tooling/cli.mjs'), 'check', root], {
        encoding: 'utf8',
      });
    assert.match(check().stdout, /legacy-v0.4/);
    await config(root, current);
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /application/);
    await mkdir(join(root, 'features/widgets'), { recursive: true });
    await writeFile(
      join(root, 'features/widgets/broken.ts'),
      'import { defineComponent } from "@xiaobaibaifqy/jingchuanchu-app/application"; export const Broken = defineComponent({selector:"broken-widget"});',
    );
    await config(root, { ...current, paths: { components: 'features/widgets' } });
    const resource = check();
    assert.notEqual(resource.status, 0);
    assert.match(resource.stderr, /broken.*Missing component template/);
    await config(root, { ...current, paths: { pages: '../escape' } });
    const invalid = check();
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /jingchuanchu.json.*project-config:paths.pages/);
  }));
