import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const baselineDirectory = 'tests/fixtures/baseline';
await mkdir(baselineDirectory, { recursive: true });
for (const [file, output] of [
  ['packages/ecs/index.ts', 'ecs.js'],
  ['packages/renderer-2d/index.ts', 'renderer.js'],
]) {
  const result = spawnSync('git', ['show', `v0.3.0:${file}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  const source = result.stdout.replaceAll('@xiaobaibaifqy/jingchuanchu-ecs', './ecs.js');
  await writeFile(
    `${baselineDirectory}/${output}`,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
  );
}
const server = await createServer({
  configFile: false,
  optimizeDeps: {
    force: true,
    exclude: ['ecs', 'core', 'browser', 'renderer-2d', 'input', 'assets', 'net', 'net-server'].map(
      (name) => '@xiaobaibaifqy/jingchuanchu-' + name,
    ),
  },
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  const address = server.httpServer!.address();
  assert(address && typeof address !== 'string');
  await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/engine.html`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { engineVerification?: unknown }).engineVerification),
    {},
    { timeout: 10000 },
  );
  assert.deepEqual(errors, []);
  const result = await page.evaluate(
    () => (window as unknown as { engineVerification: unknown }).engineVerification,
  );
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  console.log('Real Chromium 2D verification:', JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
  await rm(baselineDirectory, { recursive: true, force: true });
}
