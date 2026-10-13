import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

await mkdir('dist/packages', { recursive: true });
for (const name of await readdir('packages')) {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--silent', '--pack-destination', resolve('dist/packages')],
    { cwd: resolve('packages', name), stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) throw result.error ?? new Error(`Package packing failed: ${name}`);
}
