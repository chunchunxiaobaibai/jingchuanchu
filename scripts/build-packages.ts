import { readdir, readFile, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const packages = new Map<string, { directory: string; dependencies: Record<string, string> }>();
for (const name of await readdir('packages')) {
  const directory = resolve('packages', name);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
    name: string;
    dependencies: Record<string, string>;
  };
  packages.set(manifest.name, { directory, dependencies: manifest.dependencies });
}
const visiting = new Set<string>();
const built = new Set<string>();
async function build(name: string): Promise<void> {
  if (built.has(name)) return;
  if (visiting.has(name)) throw new Error(`Package dependency cycle: ${name}`);
  const entry = packages.get(name)!;
  visiting.add(name);
  for (const dependency of Object.keys(entry.dependencies))
    if (packages.has(dependency)) await build(dependency);
  await rm(resolve(entry.directory, 'dist'), { recursive: true, force: true });
  if (name === '@xiaobaibaifqy/jingchuanchu-tooling') {
    const output = resolve(entry.directory, 'dist');
    await mkdir(output, { recursive: true });
    for (const file of await readdir(entry.directory))
      if (/\.(mjs|d\.ts|d\.mts)$/.test(file))
        await cp(resolve(entry.directory, file), resolve(output, file));
    await writeFile(
      resolve(output, 'index.js'),
      "export {default, jingchuanchu} from './vite.mjs';\n",
    );
    await cp(resolve(entry.directory, 'vite.d.ts'), resolve(output, 'index.d.ts'));
    await cp('templates/browser', resolve(output, 'starters/browser'), {
      recursive: true,
      filter: (path) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path),
    });
    visiting.delete(name);
    built.add(name);
    console.log(`Built ${name}`);
    return;
  }
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', resolve(entry.directory, 'tsconfig.json')],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw result.error ?? new Error(`Package build failed: ${name}`);
  visiting.delete(name);
  built.add(name);
  console.log(`Built ${name}`);
}
for (const name of packages.keys()) await build(name);
