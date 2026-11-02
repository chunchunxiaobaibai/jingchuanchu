import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { build, preview, type PreviewServer } from 'vite';
import { chromium } from '@playwright/test';
import { jingchuanchu } from '../../packages/tooling/vite.mjs';

// Explicit opt-in command: starts a real browser. Never called by npm test.
const output = resolve(process.argv[2] ?? 'artifacts/performance/browser.json');
const directory = resolve('dist/audit/performance-browser');
await mkdir(dirname(output), { recursive: true });
for (const [name, root, plugins] of [
  ['benchmark', 'scripts/benchmarks', []],
  ['game', 'templates/browser', [jingchuanchu()]],
] as const) {
  await build({
    root: resolve(root),
    configFile: false,
    logLevel: 'warn',
    plugins: [...plugins],
    resolve: { conditions: ['source'] },
    build: {
      outDir: resolve(directory, name),
      emptyOutDir: true,
      ...(name === 'benchmark' ? { rollupOptions: { input: resolve(root, 'browser.html') } } : {}),
    },
  });
}
const servers: PreviewServer[] = [];
let browser;
try {
  for (const name of ['benchmark', 'game']) {
    servers.push(
      await preview({
        configFile: false,
        root: process.cwd(),
        build: { outDir: resolve(directory, name) },
        preview: { host: '127.0.0.1', port: 0 },
      }),
    );
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors: string[] = [];
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const url = (index: number) => {
    const address = servers[index]!.httpServer.address();
    assert(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const comparisonPath = resolve(dirname(output), 'browser-comparison.json');
  let comparisons: unknown;
  if (process.argv.includes('--game-only'))
    comparisons = JSON.parse(await readFile(comparisonPath, 'utf8'));
  else {
    await page.goto(url(0) + '/browser.html');
    comparisons = await page.evaluate(
      async () =>
        await (window as unknown as { performanceBenchmark: Promise<unknown> })
          .performanceBenchmark,
    );
    await writeFile(comparisonPath, JSON.stringify(comparisons, null, 2) + '\n');
  }
  // A string avoids tsx's keepNames helpers leaking into serialized callbacks.
  await page.addInitScript({
    content: `(() => {
    const failures = [];
    const describe = (error) =>
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            cause: describe(error.cause),
            ...(error instanceof AggregateError ? { errors: error.errors.map(describe) } : {}),
          }
        : error;
    window.addEventListener('error', (event) => failures.push(describe(event.error)));
    window.addEventListener('unhandledrejection', (event) => failures.push(describe(event.reason)));
    window.gameFailures = failures;
    const samples = [];
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      original((now) => {
        const start = performance.now();
        try {
          callback(now);
        } finally {
          samples.push({ start: now, duration: performance.now() - start });
        }
      });
    window.gameFrameSamples = samples;
  })();`,
  });
  await page.goto(url(1));
  await page.getByRole('link', { name: '选择关卡', exact: true }).click();
  await page.getByRole('link', { name: '查看关卡', exact: true }).first().click();
  await page.getByRole('button', { name: '选定此关', exact: true }).click();
  await page.getByRole('link', { name: '开始旅程', exact: true }).click();
  const canvas = page.locator('canvas');
  try {
    await canvas.waitFor({ timeout: 10000 });
  } catch (cause) {
    const details = {
      url: page.url(),
      errors,
      causes: await page.evaluate(
        () => (window as unknown as { gameFailures: unknown[] }).gameFailures,
      ),
      body: await page.locator('body').innerText(),
      canvases: await canvas.evaluateAll((elements) =>
        elements.map((element) => ({
          html: element.outerHTML,
          bounds: element.getBoundingClientRect().toJSON(),
        })),
      ),
    };
    await writeFile(
      resolve(dirname(output), 'browser-game-failure.json'),
      JSON.stringify(details, null, 2) + '\n',
    );
    throw new Error('Reference game canvas unavailable: ' + JSON.stringify(details), { cause });
  }
  await page.waitForFunction(
    () => (window as unknown as { gameFrameSamples: unknown[] }).gameFrameSamples.length > 30,
  );
  const beforeTime = await page.locator('game-hud .time').innerText();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const beforeMetrics = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => {
    (window as unknown as { gameFrameSamples: unknown[] }).gameFrameSamples.length = 0;
  });
  await canvas.focus();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowLeft');
  const frames = await page.evaluate(() =>
    (
      window as unknown as { gameFrameSamples: Array<{ start: number; duration: number }> }
    ).gameFrameSamples.slice(),
  );
  const afterMetrics = await cdp.send('Performance.getMetrics');
  const afterTime = await page.locator('game-hud .time').innerText();
  assert.notEqual(beforeTime, afterTime, 'The game clock must advance while measuring');
  await page.locator('game-hud button').click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(100);
  const pausedFrames = await page.evaluate(
    () => (window as unknown as { gameFrameSamples: unknown[] }).gameFrameSamples.length,
  );
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => (window as unknown as { gameFrameSamples: unknown[] }).gameFrameSamples.length,
    ),
    pausedFrames,
    'Paused game must stop requesting frames',
  );
  await page.locator('.resume').click();
  await page.waitForFunction(
    (count) =>
      (window as unknown as { gameFrameSamples: unknown[] }).gameFrameSamples.length > count,
    pausedFrames,
  );
  assert.deepEqual(errors, []);
  const stats = (values: number[]) => {
    values.sort((a, b) => a - b);
    return {
      medianMs: values[Math.floor(values.length / 2)],
      p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      maxMs: values.at(-1),
    };
  };
  const intervals = frames.slice(1).map((frame, i) => frame.start - frames[i]!.start);
  const metric = (list: typeof beforeMetrics, name: string) =>
    list.metrics.find((item) => item.name === name)!.value;
  const system = await browser.newBrowserCDPSession();
  const info = await system.send('SystemInfo.getInfo');
  const result = {
    browser: browser.version(),
    mode: 'headless Chrome; production Vite builds; DPR=1; no CPU throttling',
    gpu: info.gpu.devices.map(({ vendorString, deviceString }) => ({ vendorString, deviceString })),
    comparisons,
    referenceGame: {
      sampledFrames: frames.length,
      beforeTime,
      afterTime,
      rafCallbackCpu: stats(frames.map((frame) => frame.duration)),
      frameInterval: stats(intervals),
      intervalsOver25Ms: intervals.filter((n) => n > 25).length,
      scriptDurationMs:
        (metric(afterMetrics, 'ScriptDuration') - metric(beforeMetrics, 'ScriptDuration')) * 1000,
      layoutDurationMs:
        (metric(afterMetrics, 'LayoutDuration') - metric(beforeMetrics, 'LayoutDuration')) * 1000,
      pauseStopsFrames: true,
      resumeRestartsFrames: true,
    },
    errors,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  for (const server of servers)
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
}
