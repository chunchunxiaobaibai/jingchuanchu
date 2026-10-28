import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  mountComponent,
  nextTick,
  type ComponentDefinition,
  type WritableSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

test('reference HUD and pause panel share the parent model, update readers and emit restart intent without resuming', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-hud-'));
  try {
    const path = (file: string) =>
      JSON.stringify(relative(directory, resolve(file)).replaceAll('\\', '/'));
    const entry = join(directory, 'fixture.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';
import {GameHud} from ${path('templates/browser/src/pages/play/hud/hud.ts')};
import {PausePanel} from ${path('templates/browser/src/pages/play/pause-panel/pause-panel.ts')};
export const Fixture=defineComponent({selector:'reference-controls',components:[GameHud,PausePanel],setup(){const paused=signal(false),score=signal(2),remaining=signal(30),restarts=signal(0);return{paused,score,remaining,restarts,onRestart:()=>restarts.update(value=>value+1)};}});`,
    );
    await writeFile(
      join(directory, 'fixture.html'),
      `<section><game-hud :level-title="'林间初光'" :score="score" :remaining-seconds="remaining" model:paused="paused"></game-hud><game-pause-panel model:paused="paused" @restart-requested="onRestart()"></game-pause-panel></section>`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'controls.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    type State = {
      paused: WritableSignal<boolean>;
      score: WritableSignal<number>;
      remaining: WritableSignal<number>;
      restarts: WritableSignal<number>;
    };
    const module = (await import(pathToFileURL(join(output, 'controls.mjs')).href)) as {
      Fixture: ComponentDefinition<{}, {}, {}, State>;
    };
    const document = new Window().document as unknown as Document,
      host = document.createElement('div');
    const instance = mountComponent(host, module.Fixture),
      state = instance.exposed;
    await nextTick();
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.match(host.querySelector('.time')!.textContent!, /30/);
    state.remaining.set(12.2);
    state.score.set(5);
    await nextTick();
    assert.match(host.querySelector('.time')!.textContent!, /13/);
    assert.equal(host.querySelector('.score')!.textContent, '5');
    const pause = host.querySelector<HTMLButtonElement>('game-hud button')!;
    pause.click();
    await nextTick();
    assert.equal(state.paused(), true);
    assert.equal(pause.disabled, true);
    assert.ok(host.querySelector('[role="dialog"]'));
    host.querySelector<HTMLButtonElement>('.resume')!.click();
    await nextTick();
    assert.equal(state.paused(), false);
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(pause.disabled, false);
    pause.click();
    await nextTick();
    const staleRestart = host.querySelector<HTMLButtonElement>('.restart')!;
    staleRestart.click();
    assert.equal(state.restarts(), 1);
    assert.equal(state.paused(), true);
    state.paused.set(false);
    await nextTick();
    staleRestart.click();
    assert.equal(state.restarts(), 1);
    instance.dispose();
    pause.click();
    assert.equal(state.paused(), false);
    assert.equal(host.childNodes.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
