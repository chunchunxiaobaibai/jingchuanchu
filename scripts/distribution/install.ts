import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageEntry {
  name: string;
  file: string;
  sha256: string;
  dependencies: Record<string, string>;
}
interface Manifest {
  version: string;
  packages: PackageEntry[];
}
const presets: Record<string, string[]> = {
  core: ['ecs', 'core'],
  singleplayer: ['core', 'browser', 'renderer-2d', 'input', 'assets'],
  client: ['core', 'browser', 'renderer-2d', 'input', 'assets', 'net'],
  server: ['core', 'net-server'],
};
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'node install.mjs [--preset core|singleplayer|client|server | --modules ecs,core,...] [--target ./my-game] [--offline] [--dry-run]',
  );
} else {
  let preset = 'singleplayer';
  let modules: string[] | undefined;
  let target = process.cwd();
  let offline = false;
  let dryRun = false;
  let presetSpecified = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--offline') {
      offline = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!['--preset', '--modules', '--target'].includes(arg ?? ''))
      throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--preset') {
      preset = value;
      presetSpecified = true;
    }
    if (arg === '--modules')
      modules = value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    if (arg === '--target') target = resolve(value);
  }
  if (modules && presetSpecified) throw new Error('Use either --preset or --modules');
  const selected = modules ?? presets[preset];
  if (!selected?.length) throw new Error(`Unknown preset or empty selection: ${preset}`);
  const bundle = dirname(fileURLToPath(import.meta.url));
  if (resolve(target) === bundle)
    throw new Error('Install into your project or a starter directory, not the distribution root');
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
  const byName = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const needed = new Set<string>();
  function select(name: string): void {
    const entry = byName.get(name);
    if (!entry) throw new Error(`Unknown engine module: ${name}`);
    if (needed.has(name)) return;
    needed.add(name);
    for (const dependency of Object.keys(entry.dependencies))
      if (byName.has(dependency)) select(dependency);
  }
  for (const name of selected)
    select(
      name.startsWith('@xiaobaibaifqy/jingchuanchu-')
        ? name
        : `@xiaobaibaifqy/jingchuanchu-${name}`,
    );
  const files: string[] = [];
  for (const name of needed) {
    const entry = byName.get(name)!;
    if (
      basename(entry.file) !== entry.file ||
      !entry.file.endsWith('.tgz') ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error(`Invalid manifest entry: ${name}`);
    const file = join(bundle, 'packages', entry.file);
    const actual = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    if (actual !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`);
    files.push(file);
  }
  console.log(`Engine ${manifest.version}: ${[...needed].join(', ')}`);
  if (!dryRun) {
    await mkdir(target, { recursive: true });
    try {
      await access(join(target, 'package.json'));
    } catch {
      await writeFile(
        join(target, 'package.json'),
        JSON.stringify({ name: 'my-game', private: true, type: 'module' }, null, 2) + '\n',
      );
    }
    const installArgs = [
      'install',
      '--no-audit',
      '--no-fund',
      ...(offline ? ['--offline'] : []),
      ...files,
    ];
    // Standard Windows Node installations ship this CLI next to node.exe; invoke via Node without shell interpolation.
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    let result;
    if (process.platform === 'win32') {
      await access(npmCli);
      result = spawnSync(process.execPath, [npmCli, ...installArgs], {
        cwd: target,
        stdio: 'inherit',
      });
    } else result = spawnSync('npm', installArgs, { cwd: target, stdio: 'inherit' });
    if (result.status !== 0) throw result.error ?? new Error('npm install failed');
  }
}
