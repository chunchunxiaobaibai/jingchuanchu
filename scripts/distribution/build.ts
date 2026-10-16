import { cp, mkdir, readFile, writeFile, rm, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import ts from 'typescript';

interface PackageManifest {
  name: string;
  version: string;
  license: string;
  dependencies: Record<string, string>;
  exports: Record<string, Record<string, unknown>>;
}
const root = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(root.version))
  throw new Error('Invalid release version');
const name = `jingchuanchu-engine-${root.version}`;
const parent = resolve('dist/releases');
const output = join(parent, name);
const license = await readFile('LICENSE', 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'packages'), { recursive: true });
const entries: Array<{
  name: string;
  version: string;
  file: string;
  sha256: string;
  dependencies: Record<string, string>;
}> = [];
for (const directory of await readdir('packages')) {
  const packagePath = resolve('packages', directory);
  const manifest = JSON.parse(
    await readFile(join(packagePath, 'package.json'), 'utf8'),
  ) as PackageManifest;
  if (manifest.version !== root.version || manifest.license !== 'MIT')
    throw new Error(`Release metadata mismatch: ${manifest.name}`);
  if ((await readFile(join(packagePath, 'LICENSE'), 'utf8')) !== license)
    throw new Error(`License mismatch: ${manifest.name}`);
  await access(join(packagePath, 'README.md'));
  for (const dependency of Object.keys(manifest.dependencies))
    if (
      dependency.startsWith('@xiaobaibaifqy/jingchuanchu-') &&
      manifest.dependencies[dependency] !== `^${root.version}`
    )
      throw new Error(`Dependency version mismatch: ${manifest.name}`);
  for (const entry of Object.values(manifest.exports)) {
    for (const field of ['types', 'default']) {
      const target = entry[field];
      if (typeof target !== 'string' || !target.startsWith('./dist/'))
        throw new Error(`Invalid public entry: ${manifest.name}`);
      await access(join(packagePath, target));
    }
  }
  const file = `${manifest.name.replace('@', '').replace('/', '-')}-${root.version}.tgz`;
  const data = await readFile(resolve('dist/packages', file));
  const sha256 = createHash('sha256').update(data).digest('hex');
  await writeFile(join(output, 'packages', file), data);
  entries.push({
    name: manifest.name,
    version: manifest.version,
    file,
    sha256,
    dependencies: manifest.dependencies,
  });
}
for (const file of ['LICENSE', 'CHANGELOG.md', 'SPEC.md']) await cp(file, join(output, file));
await cp('docs', join(output, 'docs'), { recursive: true });
await cp('tasks', join(output, 'tasks'), { recursive: true }); // Specifications link to their implementation records.
await cp('templates/browser', join(output, 'starters/browser'), {
  recursive: true,
  filter: (path) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path),
});
await cp('examples', join(output, 'examples'), {
  recursive: true,
  filter: (path) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path),
});
await writeFile(
  join(output, 'README.md'),
  (await readFile('distribution/README.md', 'utf8')).replaceAll('{{VERSION}}', root.version),
);
const installer = ts.transpileModule(await readFile('scripts/distribution/install.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
await writeFile(join(output, 'install.mjs'), installer.outputText);
for (const relative of ['starters/browser', 'examples/network']) {
  const file = join(output, relative, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const dependency of Object.keys(manifest.dependencies)) {
    const entry = entries.find((value) => value.name === dependency);
    if (!entry) throw new Error(`Unknown example dependency: ${dependency}`);
    manifest.dependencies[dependency] = `file:../../packages/${entry.file}`;
  }
  for (const dependency of Object.keys(manifest.devDependencies)) {
    const entry = entries.find((value) => value.name === dependency);
    if (entry) {
      manifest.devDependencies[dependency] = `file:../../packages/${entry.file}`;
      continue;
    }
    const tool = JSON.parse(
      await readFile(resolve('node_modules', dependency, 'package.json'), 'utf8'),
    ) as { version: string };
    manifest.devDependencies[dependency] = tool.version;
  }
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(output, relative, 'LICENSE'), license);
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
const tag = spawnSync('git', ['describe', '--exact-match', '--tags', 'HEAD'], { encoding: 'utf8' });
const sourceTag = tag.status === 0 ? tag.stdout.trim() : null;
if (sourceTag !== null && sourceTag !== `v${root.version}`)
  throw new Error('Git tag and package version differ');
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      name: 'jingchuanchu-engine',
      version: root.version,
      license: 'MIT',
      sourceRevision: revision.status === 0 ? revision.stdout.trim() : null,
      sourceDirty: status.status === 0 ? !!status.stdout.trim() : null,
      sourceTag,
      packages: entries,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  join(output, 'SHA256SUMS'),
  entries.map((entry) => `${entry.sha256}  packages/${entry.file}`).join('\n') + '\n',
);
const archiveName = `${name}.tar.gz`;
const archive = join(parent, archiveName);
// GNU tar interprets a colon in -f as a remote host; keep Windows drive letters out of it.
const packed = spawnSync('tar', ['-czf', archiveName, name], {
  cwd: parent,
  stdio: 'inherit',
});
if (packed.status !== 0)
  throw packed.error ?? new Error('Release archive failed; check the tar output above');
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
console.log(`Distribution: ${archive}`);
