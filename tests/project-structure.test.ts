import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const valid: Record<string, string> = {
  'index.html':
    '<!doctype html><html><head><title>Game</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
  'tsconfig.json': JSON.stringify({
    compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext' },
  }),
  'src/main.ts': "import { start } from './app/start.js'; start();",
  'src/app/start.ts': 'export function start() {}',
  'src/contracts/game.ts': 'export interface Snapshot { paused: boolean }',
  'src/game/scenes/play.ts': 'export const scene = { id: "play" };',
  'src/ui/components/Hud/Hud.ts':
    "import html from './Hud.html?raw'; import styles from './Hud.module.css'; export const view = { html, styles };",
  'src/ui/components/Hud/Hud.html': '<section><button type="button">暂停</button></section>',
  'src/ui/components/Hud/Hud.module.css': '.root { display: flex; }',
  'src/styles/base.css': 'body { margin: 0; }',
};
async function check(changes: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'jingchuanchu-structure-'));
  try {
    for (const [name, source] of Object.entries({ ...valid, ...changes })) {
      const file = join(directory, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    return spawnSync(
      process.execPath,
      [resolve('templates/browser/scripts/check-project.mjs'), directory],
      { encoding: 'utf8' },
    );
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'jingchuanchu-structure-')));
    await rm(directory, { recursive: true, force: true });
  }
}
test('structured native TS project passes', async () => {
  const result = await check({});
  assert.equal(result.status, 0, result.stderr);
});
test('UI cannot import Engine and game cannot re-export UI through an alias', async () => {
  const result = await check({
    'src/ui/engine.ts': "import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';",
    'src/game/scenes/play.ts': "export * from '@ui/engine';",
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@ui/*': ['src/ui/*'] } },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependency-boundary/);
  assert.match(result.stderr, /src\/game\/scenes\/play.ts/);
});
test('game DOM access and dynamic imports across layers are diagnosed', async () => {
  const result = await check({
    'src/game/scenes/play.ts':
      "document.querySelector('canvas'); import('../../ui/components/Hud/Hud.js');",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /game-dom/);
  assert.match(result.stderr, /dependency-boundary/);
});
test('inline HTML behavior and global component selectors fail', async () => {
  const result = await check({
    'src/ui/components/Hud/Hud.html':
      '<section style="color:red" onclick="pause()"><script>pause()</script></section>',
    'src/ui/components/Hud/Hud.module.css': ':global(body) { color: red; } button { color: red; }',
    'src/ui/inline.ts':
      "const node = document.createElement('div'); node.innerHTML = '<p>inline</p>'; node.style.color = 'red';",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /html-inline/);
  assert.match(result.stderr, /css-scope/);
  assert.match(result.stderr, /embedded-markup/);
  assert.match(result.stderr, /embedded-style/);
});
test('misplaced files, missing component files and internal engine paths fail', async () => {
  const result = await check({
    'src/game.ts': 'export const loose = true;',
    'src/ui/components/Menu/Menu.ts': 'export const menu = true;',
    'src/app/start.ts': "import '../../../../../packages/core/index.ts';",
  });
  assert.notEqual(result.status, 0);
  for (const rule of ['file-location', 'component-files', 'engine-internals'])
    assert.match(result.stderr, new RegExp(rule));
});
