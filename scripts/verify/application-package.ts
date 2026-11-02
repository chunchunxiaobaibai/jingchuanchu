import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve('.'),
  temporary = await mkdtemp(join(tmpdir(), 'jcc-application-package-'));
const reportFile = resolve('dist/audit/application-package-report.json');
const completed: string[] = [];
const report: Record<string, unknown> = {
  status: 'running',
  completed,
  externalDependencies: 'npm prefer-offline; registry may be used for missing external tools',
  sourceConditions: false,
  consumers: [] as Record<string, unknown>[],
};
async function save() {
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
function run(args: string[], cwd: string, expectedSuccess = true, timeout = 45_000) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout });
  if (expectedSuccess)
    assert.equal(
      result.status,
      0,
      `${args.join(' ')}\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`,
    );
  return result;
}
const npmCLI = process.env.npm_execpath?.endsWith('npm-cli.js')
  ? process.env.npm_execpath
  : resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const install = (directory: string) =>
  run(
    [npmCLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'],
    directory,
  );
try {
  const bundle = join(temporary, 'bundle');
  await mkdir(join(bundle, 'packages'), { recursive: true });
  const entries = [];
  for (const directory of await readdir(join(root, 'packages'))) {
    const pkg = JSON.parse(
      await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'),
    );
    const file = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
    const archive = join(root, 'dist/packages', file),
      bytes = await readFile(archive);
    await cp(archive, join(bundle, 'packages', file));
    entries.push({
      name: pkg.name,
      version: pkg.version,
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dependencies: pkg.dependencies,
    });
  }
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ packages: entries }));
  const tooling = entries.find((entry) => entry.name === '@xiaobaibaifqy/jingchuanchu-tooling')!;
  const tool = join(temporary, 'tool');
  await mkdir(tool);
  await writeFile(
    join(tool, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: { [tooling.name]: 'file:' + join(bundle, 'packages', tooling.file) },
    }),
  );
  console.log('Installing actual packaged tooling in a temporary consumer');
  install(tool);
  const cli = join(tool, 'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs');
  completed.push('packaged-tooling-install');
  await save();
  for (const { legacy, style, name } of [
    { legacy: false, style: 'css', name: 'application-css' },
    { legacy: false, style: 'less', name: 'application-less' },
    { legacy: true, style: 'css', name: 'legacy' },
  ]) {
    const project = join(temporary, name);
    const consumer: Record<string, unknown> = { name, style, legacy };
    (report.consumers as Record<string, unknown>[]).push(consumer);
    run(
      [
        cli,
        'create',
        project,
        '--bundle',
        bundle,
        '--style',
        style,
        ...(legacy ? ['--profile', 'legacy-v0.4'] : []),
      ],
      tool,
    );
    console.log(
      `Installing ${legacy ? 'legacy' : 'application'} project from actual engine archives`,
    );
    install(project);
    const localCLI = join(project, 'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs');
    if (!legacy) {
      assert.deepEqual(
        await readFile(join(project, '.gitignore')),
        await readFile(join(root, 'templates/browser/.gitignore')),
      );
      const configuration = JSON.parse(await readFile(join(project, 'tsconfig.json'), 'utf8'));
      assert.equal('customConditions' in configuration.compilerOptions, false);
      for (const file of [
        'src/assets/audio/collect.wav',
        'src/assets/audio/complete.wav',
        'src/assets/audio/timeout.wav',
        'src/themes/default/assets/collectibles.svg',
        'src/themes/dusk/assets/star.svg',
        'public/theme-assets-license.txt',
      ])
        assert.deepEqual(
          await readFile(join(project, file)),
          await readFile(join(root, 'templates/browser', file)),
        );
      await readFile(join(project, `src/pages/play/play-page.${style}`));
      await readFile(join(project, 'src/pages/result/result-page.ts'));
      consumer.completeTemplateAndMedia = true;
      for (const args of [
        ['page', 'bonus', '--route', '/bonus'],
        ['component', 'score-panel', '--page', 'bonus'],
        ['scene', 'bonus', '--page', 'bonus'],
        ['store', 'score', '--domain', 'session'],
        ['theme', 'custom'],
        ['theme', 'forest', '--extends', 'custom'],
      ])
        run([localCLI, 'generate', ...args], project);
      const source = `import assert from 'node:assert/strict'; import {defineApplication, AuthService} from '@xiaobaibaifqy/jingchuanchu-app/application'; import {defineView} from '@xiaobaibaifqy/jingchuanchu-app'; assert.equal(typeof defineApplication,'function'); assert.equal(typeof AuthService,'function'); assert.equal(typeof defineView,'function'); console.log(import.meta.resolve('@xiaobaibaifqy/jingchuanchu-app/application'));`;
      const resolved = run(['--input-type=module', '-e', source], project).stdout.trim();
      assert.match(
        resolved,
        /node_modules\/@xiaobaibaifqy\/jingchuanchu-app\/dist\/application.js$/,
      );
      report.applicationResolution = resolved;
    }
    console.log(
      `Checking and building ${legacy ? 'legacy' : 'application'} project without source conditions`,
    );
    // Full template diagnostics plus Vite compilation can exceed the short CLI-operation limit.
    run([npmCLI, 'run', 'build', ...(legacy ? [] : ['--', '--manifest'])], project, true, 180_000);
    if (!legacy) {
      const manifest = JSON.parse(
        await readFile(join(project, 'dist/.vite/manifest.json'), 'utf8'),
      ) as Record<string, { isDynamicEntry?: boolean }>;
      const dynamicPages = Object.values(manifest).filter((entry) => entry.isDynamicEntry).length;
      assert.ok(dynamicPages >= 6);
      consumer.dynamicPageChunks = dynamicPages;
      assert.deepEqual(
        await readFile(join(project, 'dist/theme-assets-license.txt')),
        await readFile(join(root, 'LICENSE')),
      );
      const emittedAudio = (await readdir(join(project, 'dist/assets'))).filter((file) =>
        file.endsWith('.wav'),
      );
      assert.equal(emittedAudio.length, 3);
      consumer.audioAssets = emittedAudio;
      consumer.licenseCopied = true;
      report.dynamicPageChunks = dynamicPages;
      const html = join(project, 'src/pages/play/hud/hud.html'),
        original = await readFile(html, 'utf8');
      try {
        await writeFile(html, '<section>{{ missingValue }}</section>');
        const invalid = run([localCLI, 'check'], project, false);
        assert.notEqual(invalid.status, 0);
        assert.match(invalid.stdout + invalid.stderr, /hud.html:1/);
      } finally {
        await writeFile(html, original);
      }
      completed.push(`${name}-build-media-and-source-diagnostic`);
    } else completed.push('legacy-build');
    const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { resolved?: string }>;
    };
    for (const [name, entry] of Object.entries(lock.packages))
      if (name.startsWith('node_modules/@xiaobaibaifqy/jingchuanchu-'))
        assert.match(entry.resolved!, /^file:vendor\//);
    assert.equal('node_modules/ws' in lock.packages, false);
    consumer.status = 'passed';
    await save();
  }
  report.status = 'passed';
  await save();
  console.log(`Application/legacy packaged consumers passed. Report: ${reportFile}`);
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  await save();
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
