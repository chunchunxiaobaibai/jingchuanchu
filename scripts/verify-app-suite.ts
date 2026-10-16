import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const bundle = resolve('dist/releases', `jingchuanchu-engine-${version}`);
const temporary = await mkdtemp(join(tmpdir(), 'jingchuanchu-suite-'));
function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm.cmd',
  });
  if (result.status !== 0) throw result.error ?? new Error(`${command} ${args.join(' ')} failed`);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  // Bootstrap the actual packaged CLI into a separate tool project.
  const tool = join(temporary, 'tool');
  await mkdir(tool);
  await writeFile(
    join(tool, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: {
        '@xiaobaibaifqy/jingchuanchu-tooling': `file:${join(bundle, 'packages', `xiaobaibaifqy-jingchuanchu-tooling-${version}.tgz`)}`,
      },
    }),
  );
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], tool);
  const cli = join(tool, 'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs');
  for (const [preset, style] of [
    ['core', 'css'],
    ['server', 'css'],
    ['singleplayer', 'css'],
    ['singleplayer', 'less'],
    ['client', 'css'],
  ] as const) {
    if (process.argv.includes('--browser-only') && ['core', 'server'].includes(preset)) continue;
    const project = join(temporary, `${preset}-${style}`);
    run(
      process.execPath,
      [cli, 'create', project, '--preset', preset, '--style', style, '--bundle', bundle],
      tool,
    );
    run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], project);
    const browser = ['singleplayer', 'client'].includes(preset);
    if (browser) {
      const localCli = join(
        project,
        'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs',
      );
      run(process.execPath, [localCli, 'generate', 'view', 'score-panel'], project);
      run(process.execPath, [localCli, 'generate', 'scene', 'menu'], project);
      if (style === 'less') {
        await writeFile(join(project, 'src/styles/tokens.less'), '@accent: #176b58;');
        await writeFile(
          join(project, 'src/ui/components/score-panel/score-panel.less'),
          '@import "../../../styles/tokens.less"; section {color:@accent;}',
        );
      }
    }
    run(npm, ['run', 'build'], project);
    const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
    for (const [name, entry] of Object.entries(lock.packages) as Array<
      [string, { resolved?: string }]
    >)
      if (name.startsWith('node_modules/@xiaobaibaifqy/jingchuanchu-'))
        assert.ok(entry.resolved?.startsWith('file:'), name);
    if (preset !== 'server') assert.equal('node_modules/ws' in lock.packages, false);
    if (preset === 'core') assert.equal('node_modules/less' in lock.packages, false);
    if (browser)
      assert.ok((await readFile(join(project, 'dist/index.html'), 'utf8')).includes('game-app'));
    console.log(`Packaged CLI consumer passed: ${preset}/${style}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
