import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';

await mkdir('dist/packages', { recursive: true });
for (const name of await readdir('packages')) {
  const result = spawnSync(
    process.platform === 'win32' ? process.execPath : 'npm',
    [
      ...(process.platform === 'win32'
        ? [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
        : []),
      'pack',
      '--ignore-scripts',
      '--silent',
      '--pack-destination',
      resolve('dist/packages'),
    ],
    { cwd: resolve('packages', name), stdio: 'inherit' },
  );
  if (result.status !== 0) throw result.error ?? new Error(`Package packing failed: ${name}`);
}
