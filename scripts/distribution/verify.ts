import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0)
    throw result.error ?? new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const root = resolve('.');
const version = (JSON.parse(await readFile('package.json', 'utf8')) as { version: string }).version;
const archive = resolve('dist/releases', `xiaobaifqy-engine-${version}.tar.gz`);
const checksum = (await readFile(`${archive}.sha256`, 'utf8')).split(' ')[0];
assert.equal(
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  checksum,
);
const temporary = await mkdtemp(join(tmpdir(), 'xiaobai-distribution-'));
try {
  run('tar', ['-xzf', archive, '-C', temporary], root);
  const bundle = join(temporary, `xiaobaifqy-engine-${version}`);
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as {
    packages: Array<{ name: string; file: string; sha256: string }>;
  };
  assert.equal(manifest.packages.length, 8);
  const license = await readFile(join(bundle, 'LICENSE'), 'utf8');
  for (const entry of manifest.packages) {
    const file = join(bundle, 'packages', entry.file);
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      entry.sha256,
    );
    const list = run('tar', ['-tzf', file], root).trim().split('\n');
    for (const required of [
      'package/README.md',
      'package/LICENSE',
      'package/package.json',
      'package/dist/index.js',
      'package/dist/index.d.ts',
    ])
      assert.ok(list.includes(required), `${entry.name} missing ${required}`);
    for (const path of list)
      assert.ok(
        /^package\/(?:dist\/|README\.md$|LICENSE$|package\.json$|[^/]+\.ts$)/.test(path),
        `Unexpected packed file: ${path}`,
      );
    assert.equal(run('tar', ['-xOf', file, 'package/LICENSE'], root), license);
    const packageInfo = JSON.parse(run('tar', ['-xOf', file, 'package/package.json'], root)) as {
      version: string;
      license: string;
    };
    assert.equal(packageInfo.version, version);
    assert.equal(packageInfo.license, 'MIT');
  }
  async function checkLinks(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['packages', 'node_modules'].includes(entry.name)) await checkLinks(file);
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(file, 'utf8');
        for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = match[1]!.split('#')[0]!;
          if (!target || /^(?:https?:|mailto:|\/)/.test(target)) continue;
          await access(resolve(dirname(file), target));
        }
      }
    }
  }
  await checkLinks(bundle);
  const installer = join(bundle, 'install.mjs');
  const core = join(temporary, 'core-project');
  run(process.execPath, [installer, '--preset', 'core', '--target', core, '--offline'], root);
  const coreLock = JSON.parse(await readFile(join(core, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, unknown>;
  };
  for (const forbidden of ['ws', 'zod', '@xiaobai/browser', '@xiaobai/net', '@xiaobai/net-server'])
    assert.equal(`node_modules/${forbidden}` in coreLock.packages, false);
  await writeFile(
    join(core, 'consumer.ts'),
    "import { Engine } from '@xiaobai/core';\nimport { component } from '@xiaobai/ecs';\nconst Value = component<number>('Value'); const engine = new Engine(); const entity = engine.world.create(); engine.world.set(entity, Value, 42); if(engine.world.require(entity, Value) !== 42) throw new Error('Invalid ECS'); engine.dispose();\n",
  );
  await writeFile(
    join(core, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        lib: ['ES2022'],
        types: [],
        outDir: 'compiled',
      },
      include: ['consumer.ts'],
    }),
  );
  run(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', join(core, 'tsconfig.json')],
    core,
  );
  run(process.execPath, ['compiled/consumer.js'], core);
  const dryTarget = join(temporary, 'dry-run');
  run(
    process.execPath,
    [installer, '--modules', 'core,assets', '--target', dryTarget, '--dry-run'],
    root,
  );
  await assert.rejects(access(dryTarget));
  const failed = spawnSync(
    process.execPath,
    [installer, '--preset', 'unknown', '--target', dryTarget],
    { encoding: 'utf8' },
  );
  assert.notEqual(failed.status, 0);
  await assert.rejects(access(dryTarget));
  const original = await readFile(join(bundle, 'packages', manifest.packages[0]!.file));
  await writeFile(join(bundle, 'packages', manifest.packages[0]!.file), 'corrupted');
  const damaged = spawnSync(
    process.execPath,
    [installer, '--modules', manifest.packages[0]!.name, '--target', dryTarget, '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.notEqual(damaged.status, 0);
  assert.match(damaged.stderr, /Checksum mismatch/);
  await assert.rejects(access(dryTarget));
  await writeFile(join(bundle, 'packages', manifest.packages[0]!.file), original);
  run(
    process.execPath,
    [installer, '--modules', 'core,assets', '--target', core, '--offline'],
    root,
  );
  await cp(join(bundle, 'examples'), join(core, 'examples'), {
    recursive: true,
    filter: (path) => !path.endsWith('/network'),
  });
  await writeFile(
    join(core, 'examples.tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        lib: ['ES2022', 'DOM'],
        types: [],
        outDir: 'compiled-examples',
      },
      include: ['examples/*.ts'],
    }),
  );
  run(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'examples.tsconfig.json'],
    core,
  );
  for (const file of ['headless', 'custom-module', 'assets'])
    run(process.execPath, [`compiled-examples/${file}.js`], core);
  const starter = join(bundle, 'starters/browser');
  run('npm', ['install', '--offline', '--include=dev', '--no-audit', '--no-fund'], starter);
  run('npm', ['run', 'build'], starter);
  const starterLock = JSON.parse(await readFile(join(starter, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, unknown>;
  };
  for (const forbidden of ['ws', 'zod', '@xiaobai/net', '@xiaobai/net-server'])
    assert.equal(`node_modules/${forbidden}` in starterLock.packages, false);
  // Production build is served by the consumer's own Vite, never the engine workspace.
  const { preview } = (await import(
    resolve(starter, 'node_modules/vite/dist/node/index.js')
  )) as typeof import('vite');
  const previewServer = await preview({ root: starter, preview: { port: 0, host: '127.0.0.1' } });
  const address = previewServer.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing preview address');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let sockets = 0;
    const errors: string[] = [];
    page.on('websocket', () => {
      sockets++;
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const before = await page.locator('canvas').screenshot();
    await page.locator('canvas').focus();
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.up('ArrowRight');
    assert.equal((await page.locator('canvas').screenshot()).equals(before), false);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    assert.equal(await page.locator('#status').innerText(), '已暂停');
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({
      path: resolve('test-results/distribution-starter.png'),
      fullPage: true,
    });
    assert.equal(sockets, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose, reject) =>
      previewServer.httpServer.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
  const networking = join(bundle, 'examples/network');
  // Vite preview sets NODE_ENV=production in this process; the example's TS check still needs its development types.
  run('npm', ['install', '--offline', '--include=dev', '--no-audit', '--no-fund'], networking);
  run('npm', ['run', 'check'], networking);
  run(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
      '--noEmit',
      'false',
      '--outDir',
      'compiled',
    ],
    networking,
  );
  await writeFile(
    join(networking, 'verify.mjs'),
    `import { createPingServer } from './compiled/server.js';
import { createPingClient } from './compiled/client.js';
const server = await createPingServer(0);
let client; let timer;
try {
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Ping timeout')), 3000);
    client = createPingClient('ws://127.0.0.1:' + server.port + '/ws', message => { if (message.type === 'pong') { clearTimeout(timeout); resolve(message); } });
    timer = setInterval(() => { if(client.connection.status === 'open') { clearInterval(timer); client.ping(); } }, 10);
  });
  await result;
} finally { clearInterval(timer); client?.engine.dispose(); await server.close(); }
`,
  );
  run(process.execPath, ['verify.mjs'], networking);
  console.log(
    'Distribution verification passed: archive/license/docs, selected installer, checksums, headless/examples, isolated browser starter, real network roundtrip',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
