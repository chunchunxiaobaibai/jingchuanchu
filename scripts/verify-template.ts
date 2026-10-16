import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const version = (JSON.parse(await readFile('package.json', 'utf8')) as { version: string }).version;
const temporary = await mkdtemp(join(tmpdir(), 'jingchuanchu-template-'));
function npm(args: string[], cwd: string): void {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          process.execPath,
          [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args],
          { cwd, stdio: 'inherit' },
        )
      : spawnSync('npm', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw result.error ?? new Error(`Template npm ${args[0]} failed`);
}
try {
  const bundle = resolve('dist/releases', `jingchuanchu-engine-${version}`);
  await cp(join(bundle, 'packages'), join(temporary, 'packages'), { recursive: true });
  const target = join(temporary, 'starters/browser');
  await cp(join(bundle, 'starters/browser'), target, { recursive: true });
  npm(['install', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund'], target);
  npm(['run', 'build'], target);
  const lock = JSON.parse(await readFile(join(target, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; resolved?: string }>;
  };
  for (const [name, item] of Object.entries(lock.packages)) {
    if (name.startsWith('node_modules/@xiaobaibaifqy/jingchuanchu-')) {
      assert.equal(item.version, version);
      assert.ok(item.resolved?.startsWith('file:'));
    }
  }
  assert.equal('node_modules/ws' in lock.packages, false);
  assert.ok((await readFile(join(target, 'dist/index.html'), 'utf8')).includes('id="app"'));
  console.log(
    'Isolated native template: local package installation, structure, TS and Vite build passed; no browser started',
  );
} finally {
  assert.ok(temporary.startsWith(join(tmpdir(), 'jingchuanchu-template-')));
  await rm(temporary, { recursive: true, force: true });
}
