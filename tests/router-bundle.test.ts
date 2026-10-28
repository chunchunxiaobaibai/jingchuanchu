import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import type { RollupOutput, OutputChunk } from 'rollup';
import type { RouteDefinition } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

test('Vite keeps a compiled three-file game page outside the initial static graph and loads its module only on demand', async (t) => {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/router-bundle-'));
  const probe = `jcc-lazy-${basename(directory)}`;
  try {
    const entry = join(directory, 'app.ts');
    await writeFile(
      entry,
      `import {defineComponent,RouterOutlet,defineRoutes,defineApplication} from '@xiaobaibaifqy/jingchuanchu-app/application';
export const Root=defineComponent({selector:'bundle-root',components:[RouterOutlet]});
export const routes=defineRoutes([{name:'play',path:'/play',loadPage:()=>import('./play-page.js').then(m=>m.PlayPage)}]);
export const application=defineApplication({root:Root,routes,router:{mode:'hash'}});`,
    );
    await writeFile(join(directory, 'app.html'), '<main><router-outlet></router-outlet></main>');
    await writeFile(
      join(directory, 'play-page.ts'),
      `import {definePage} from '@xiaobaibaifqy/jingchuanchu-app/application';
const probe=globalThis as unknown as Record<string,number>;
probe[${JSON.stringify(probe)}]=(probe[${JSON.stringify(probe)}]??0)+1;
export const PlayPage=definePage({selector:'lazy-play-page'});`,
    );
    await writeFile(join(directory, 'play-page.html'), '<section>LAZY_PLAY_ONLY</section>');
    await writeFile(
      join(directory, 'play-page.less'),
      '@accent: #176b58; section {color:@accent;}',
    );
    const output = join(directory, 'output');
    const built = (await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'app.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    })) as RollupOutput | RollupOutput[];
    const outputs = Array.isArray(built) ? built : [built];
    const chunks = outputs.flatMap((result) =>
      result.output.filter((item): item is OutputChunk => item.type === 'chunk'),
    );
    const main = chunks.find((chunk) => chunk.isEntry)!;
    const play = chunks.find((chunk) =>
      Object.keys(chunk.modules).some((id) => id.replaceAll('\\', '/').endsWith('/play-page.ts')),
    )!;
    assert.ok(main);
    assert.ok(play);
    assert.notEqual(main.fileName, play.fileName);
    assert.equal(play.isDynamicEntry, true);
    const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const staticFiles = new Set<string>();
    const walk = (chunk: OutputChunk): void => {
      if (staticFiles.has(chunk.fileName)) return;
      staticFiles.add(chunk.fileName);
      for (const imported of chunk.imports) {
        const next = byName.get(imported);
        if (next) walk(next);
      }
    };
    walk(main);
    assert.equal(staticFiles.has(play.fileName), false);
    assert.ok(
      [...staticFiles].some((file) => byName.get(file)!.dynamicImports.includes(play.fileName)),
    );
    assert.ok(!main.code.includes('LAZY_PLAY_ONLY'));
    assert.ok(play.code.includes('LAZY_PLAY_ONLY'));
    assert.equal(Reflect.get(globalThis, probe), undefined);
    const module = (await import(pathToFileURL(join(output, main.fileName)).href)) as {
      routes: readonly RouteDefinition[];
    };
    assert.equal(Reflect.get(globalThis, probe), undefined);
    const load = module.routes[0]!.loadPage;
    assert.ok(load);
    const page = await load();
    assert.equal(page.kind, 'page');
    assert.equal(page.selector, 'lazy-play-page');
    assert.match(String(Reflect.get(page, '$template')), /LAZY_PLAY_ONLY/);
    assert.match(String(Reflect.get(page, '$style')), /data-jcc-/);
    assert.equal(Reflect.get(globalThis, probe), 1);
    assert.equal(await load(), page);
    assert.equal(Reflect.get(globalThis, probe), 1);
    t.diagnostic(
      `${chunks.length} JS chunks; entry ${main.fileName}; lazy page ${play.fileName}; outside initial static graph`,
    );
  } finally {
    Reflect.deleteProperty(globalThis, probe);
    await rm(directory, { recursive: true, force: true });
  }
});
