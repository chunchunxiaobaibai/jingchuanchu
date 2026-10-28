import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadProjectConfig } from '../packages/tooling/project-config.mjs';
import { checkApplicationProject } from '../packages/tooling/project-check.mjs';
async function check(changes: Record<string, string>, paths = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jcc-app-structure-'));
  try {
    const sources = {
      'jingchuanchu.json': JSON.stringify({ schemaVersion: 2, profile: 'application', paths }),
      'src/main.ts': "import './app/start.js';",
      'src/app/start.ts': 'export {};',
      ...changes,
    };
    for (const [name, source] of Object.entries(sources)) {
      const file = join(root, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    return await checkApplicationProject(await loadProjectConfig(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('application structure accepts business session folders and regular shared CSS/Less without legacy UI layout', async () => {
  const diagnostics = await check({
    'src/game/session/game-store.ts': 'export const score = 1;',
    'src/pages/play/play-page.ts':
      "import {score} from '../../game/session/game-store.js'; import './play-page.less'; void score;",
    'src/pages/play/play-page.html': '<main><h1>Play</h1></main>',
    'src/pages/play/play-page.less': '@import "../../styles/palette.less"; main { color: @ink; }',
    'src/styles/palette.less': '@ink: black;',
    'src/components/icon-button/icon-button.ts': 'export {};',
    'src/components/icon-button/icon-button.css': 'button { color: black; }',
  });
  assert.deepEqual(diagnostics, []);
});

test('configured paths determine dependency layers including alias reexports and dynamic imports', async () => {
  const diagnostics = await check(
    {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          moduleResolution: 'Bundler',
          baseUrl: '.',
          paths: { '@screens/*': ['features/screens/*'] },
        },
      }),
      'features/screens/play/play-page.ts': 'export const Play = {};',
      'features/widgets/hud.ts': "import('@screens/play/play-page.js');",
      'rules/game/session.ts':
        "export * from '@screens/play/play-page.js'; document.title = 'game';",
    },
    { pages: 'features/screens', components: 'features/widgets', game: 'rules/game' },
  );
  assert.ok(
    diagnostics.some((item) => /features\/widgets\/hud.ts:1 \[dependency-boundary\]/.test(item)),
  );
  assert.ok(
    diagnostics.some((item) => /rules\/game\/session.ts:1 \[dependency-boundary\]/.test(item)),
  );
  assert.ok(diagnostics.some((item) => /rules\/game\/session.ts:1 \[game-dom\]/.test(item)));
});

test('shared UI cannot import/reexport Engine and business code cannot use engine internals', async () => {
  const diagnostics = await check({
    'src/components/hud/hud.ts':
      "import {Engine as Runtime} from '@xiaobaibaifqy/jingchuanchu-core'; export {Engine} from '@xiaobaibaifqy/jingchuanchu-core'; void Runtime;",
    'src/pages/play/play-page.ts': "import '../../../packages/core/index.ts';",
  });
  assert.ok(diagnostics.some((item) => item.includes('[dependency-boundary]')));
  assert.ok(diagnostics.some((item) => item.includes('[engine-internals]')));
});

test('misplaced or dotted business filenames and unresolved dynamic dependencies report original sources', async () => {
  const diagnostics = await check({
    'src/pages/play/play.page.ts': "import('@unknown/module');",
    'src/loose.ts': 'export {};',
  });
  assert.ok(diagnostics.some((item) => /play.page.ts:1 \[business-name\]/.test(item)));
  assert.ok(diagnostics.some((item) => /play.page.ts:1 \[unresolved-import\]/.test(item)));
  assert.ok(diagnostics.some((item) => /src\/loose.ts:1 \[file-location\]/.test(item)));
});
