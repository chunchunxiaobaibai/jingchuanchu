import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { defineComponent, mountComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { compileViews } from '../packages/tooling/compiler.mjs';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

async function fixture(run: (directory: string) => Promise<void>) {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/component-template-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('new component/page factories and aliases associate HTML/CSS/Less without legacy binding tables', () =>
  fixture(async (directory) => {
    const file = join(directory, 'hud.ts');
    const code =
      "import {defineComponent as component, definePage} from '@xiaobaibaifqy/jingchuanchu-app/application'; export const Hud=component({selector:'game-hud',setup(){return{score:1}}}); export const Page=definePage({selector:'play-page',templateUrl:'./page.html',components:[Hud]});";
    await writeFile(join(directory, 'hud.html'), '<section>{{ score }}</section>');
    await writeFile(join(directory, 'page.html'), '<main><game-hud></game-hud></main>');
    await writeFile(join(directory, 'tokens.less'), '@accent: #176b58;');
    await writeFile(join(directory, 'hud.less'), '@import "tokens.less"; section {color:@accent;}');
    const result = (await compileViews(code, file))!;
    assert.equal(result.resources.length, 2);
    assert.match(result.resources[0]!.css, /section\[data-jcc-/);
    assert.ok(result.dependencies.includes(join(directory, 'page.html')));
    assert.ok(result.dependencies.includes(join(directory, 'tokens.less')));
    assert.ok(result.code.includes('$source:'));
    assert.ok(result.code.includes('{{ score }}'));
    const unrelated = await compileViews(
      "import {defineComponent} from './other.js'; defineComponent({});",
      file,
    );
    assert.equal(unrelated, null);
  }));

test('new metadata diagnoses missing/ambiguous resources and retains static template safety', () =>
  fixture(async (directory) => {
    const file = join(directory, 'panel.ts'),
      code =
        "import {defineComponent} from '@xiaobaibaifqy/jingchuanchu-app/application';export const Panel=defineComponent({selector:'game-panel'});";
    await assert.rejects(compileViews(code, file), /panel.ts.*Missing component template/);
    await writeFile(join(directory, 'panel.html'), '<section>safe</section>');
    assert.equal((await compileViews(code, file))!.resources.length, 0);
    await writeFile(join(directory, 'panel.css'), 'section {color:red;}');
    await writeFile(join(directory, 'panel.less'), 'section {color:blue;}');
    await assert.rejects(compileViews(code, file), /Ambiguous/);
    const explicit = code.replace(
      "selector:'game-panel'",
      "selector:'game-panel',styleUrl:'./panel.less'",
    );
    assert.match((await compileViews(explicit, file))!.resources[0]!.css, /blue/);
    await writeFile(join(directory, 'panel.html'), '<section onclick="unsafe()">bad</section>');
    await assert.rejects(compileViews(explicit, file), /panel.html:1.*Inline/);
  }));

test('Vite emits a mountable new static component with compiled scoped resources', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'fixture.ts');
    await writeFile(
      entry,
      "import {defineComponent} from '@xiaobaibaifqy/jingchuanchu-app/application';export const Fixture=defineComponent({selector:'fixture-view'});",
    );
    await writeFile(
      join(directory, 'fixture.html'),
      '<section ref="content">compiled fixture</section>',
    );
    await writeFile(join(directory, 'fixture.css'), 'section {color: rgb(1, 2, 3);}');
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'fixture.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const code = await readFile(join(output, 'fixture.mjs'), 'utf8');
    assert.ok(!code.includes('?inline'));
    const module = (await import(pathToFileURL(join(output, 'fixture.mjs')).href)) as {
      Fixture: ReturnType<typeof defineComponent>;
    };
    const window = new Window(),
      document = window.document as unknown as Document,
      host = document.createElement('div');
    const instance = mountComponent(host, module.Fixture);
    const section = host.querySelector('section')!;
    assert.equal(section.textContent, 'compiled fixture');
    assert.ok(section.hasAttribute(module.Fixture.$scope!));
    assert.match(host.querySelector('style')!.textContent!, /data-jcc-/);
    instance.dispose();
    assert.equal(host.childNodes.length, 0);
  }));

test('virtual TypeScript diagnoses expression, DOM and child contracts at HTML locations', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'typed.ts');
    const code = `import {defineComponent,input,output,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';
  const Child=defineComponent({selector:'typed-child',templateUrl:'./child.html',inputs:{score:input<number>({required:true})},outputs:{scoreChanged:output<number>()}});
  export const Parent=defineComponent({selector:'typed-parent',components:[Child],setup(){return {count:signal(1),save:(amount:number)=>amount};}});`;
    await writeFile(entry, code);
    await writeFile(join(directory, 'child.html'), '<span>child</span>');
    await writeFile(
      join(directory, 'typed.html'),
      `<p>{{ missing }}</p>
<button :disabled="count">bad property</button>
<typed-child :score="'wrong'" @score-changed="save($event.length)"></typed-child>
<button @click="save($event)">bad event</button>`,
    );
    await assert.rejects(compileViews(code, entry), (error) => {
      const message = String(error);
      assert.match(message, /typed.html:1:\d+.*missing/);
      assert.match(message, /typed.html:2:\d+.*number.*boolean/);
      assert.match(message, /typed.html:3:\d+.*string.*number/);
      assert.match(message, /typed.html:3:\d+.*length/);
      assert.match(message, /typed.html:4:\d+.*number/);
      return true;
    });
    await writeFile(
      join(directory, 'typed.html'),
      '<typed-child :score="count" :missing="count"></typed-child>',
    );
    await assert.rejects(compileViews(code, entry), /Unknown component input: missing/);
    await writeFile(join(directory, 'typed.html'), '<typed-child></typed-child>');
    await assert.rejects(compileViews(code, entry), /Missing required component input: score/);
    await writeFile(join(directory, 'typed.html'), '<typed-child score="literal"></typed-child>');
    await assert.rejects(compileViews(code, entry), /string.*number/);
    for (const expression of [
      'count = 2',
      'globalThis.alert(1)',
      'save.constructor("return 1")()',
      'save["constructor"]',
      'new Date()',
      'count++',
    ]) {
      await writeFile(join(directory, 'typed.html'), `<p>{{ ${expression} }}</p>`);
      await assert.rejects(compileViews(code, entry), /typed.html:1:/);
    }
  }));

test('compiled expressions update text, DOM properties and child contracts; owners stop events and rendering', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'reactive.ts');
    await writeFile(
      entry,
      `import {defineComponent,input,output,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';
  export const updates:string[]=[];
  const Child=defineComponent({selector:'reactive-child',templateUrl:'./child.html',inputs:{score:input<number>({required:true})},outputs:{scoreChanged:output<number>()},onBeforeUpdate(){updates.push('child:before');},onUpdated(){updates.push('child:after');},setup(c){return{score:c.inputs.score,choose:()=>c.emit('scoreChanged',c.inputs.score()+1)}}});
  export const Reactive=defineComponent({selector:'reactive-parent',components:[Child],onBeforeUpdate(){updates.push('parent:before');},onUpdated(){updates.push('parent:after');},setup(){const count=signal(1);return{count,caption:signal('<safe>'),blocked:signal(false),raise:(amount:number)=>count.set(amount),click:()=>count.update(n=>n+1),classes:signal({selected:true,hidden:false})};}});`,
    );
    await writeFile(
      join(directory, 'child.html'),
      '<button @click="choose()">child {{ score }}</button>',
    );
    await writeFile(
      join(directory, 'reactive.html'),
      `<p>{{ caption }} / {{ count + 1 }}</p><button :disabled="blocked" :class="classes" @click="click()">parent</button><reactive-child :score="count" @score-changed="raise($event)"></reactive-child><input :value="caption" @input="raise($event.currentTarget.value.length)" />`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'reactive.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'reactive.mjs')).href)) as {
      Reactive: ReturnType<typeof defineComponent>;
      updates: string[];
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement;
    const instance = mountComponent(host, module.Reactive),
      state = instance.exposed as {
        count: import('@xiaobaibaifqy/jingchuanchu-app/application').WritableSignal<number>;
        caption: import('@xiaobaibaifqy/jingchuanchu-app/application').WritableSignal<string>;
        blocked: import('@xiaobaibaifqy/jingchuanchu-app/application').WritableSignal<boolean>;
      };
    const settle = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    await settle();
    const button = host.querySelector('button')!,
      child = host.querySelector('reactive-child button')!;
    assert.equal(host.querySelector('p')!.textContent, '<safe> / 2');
    assert.equal(host.querySelector('p')!.children.length, 0);
    assert.equal(button.className, 'selected');
    assert.equal(button.disabled, false);
    assert.equal(child.textContent, 'child 1');
    child.dispatchEvent(new window.MouseEvent('click') as unknown as Event);
    await settle();
    assert.equal(state.count(), 2);
    assert.equal(child.textContent, 'child 2');
    assert.deepEqual(module.updates, [
      'parent:before',
      'child:before',
      'child:after',
      'parent:after',
    ]);
    state.caption.set('updated');
    state.blocked.set(true);
    await settle();
    assert.equal(host.querySelector('input')!.value, 'updated');
    assert.equal(button.disabled, true);
    instance.deactivate();
    state.count.set(9);
    button.dispatchEvent(new window.MouseEvent('click') as unknown as Event);
    await settle();
    assert.equal(state.count(), 9);
    assert.equal(child.textContent, 'child 2');
    instance.activate();
    await settle();
    assert.equal(child.textContent, 'child 9');
    const input = host.querySelector('input')!;
    input.value = 'five!';
    input.dispatchEvent(new window.Event('input') as unknown as Event);
    await settle();
    assert.equal(state.count(), 5);
    instance.dispose();
    button.dispatchEvent(new window.MouseEvent('click') as unknown as Event);
    state.count.set(20);
    await settle();
    assert.equal(host.childNodes.length, 0);
    assert.equal(child.textContent, 'child 5');
  }));
