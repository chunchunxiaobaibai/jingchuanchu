import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  defineComponent,
  mountComponent,
  nextTick,
  type WritableSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { compileViews } from '../packages/tooling/compiler.mjs';
import { jingchuanchu } from '../packages/tooling/vite.mjs';
async function fixture(run: (directory: string) => Promise<void>) {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/component-structure-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('when conditions and their inner expressions are checked at original HTML locations', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'panel.ts');
    const code =
      "import {defineComponent,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';export const Panel=defineComponent({selector:'conditional-panel',setup(){return{count:signal(1),visible:signal(true)}}});";
    await writeFile(entry, code);
    await writeFile(
      join(directory, 'panel.html'),
      '<template when="count">\n<p>{{ missing }}</p>\n</template>',
    );
    await assert.rejects(compileViews(code, entry), (error) => {
      const message = String(error);
      assert.match(message, /panel.html:1:\d+.*number.*boolean/);
      assert.match(message, /panel.html:2:\d+.*missing/);
      return true;
    });
    await writeFile(
      join(directory, 'panel.html'),
      '<template when="visible" each="item of items"><p>ambiguous</p></template>',
    );
    await assert.rejects(
      compileViews(code, entry),
      /when template only accepts one when attribute/,
    );
  }));

test('nested when creates only active branches, releases components/listeners and resumes without stale owners', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'panel.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal,input} from '@xiaobaibaifqy/jingchuanchu-app/application';
  export const calls:string[]=[];export let clicks=0;
  const Child=defineComponent({selector:'branch-child',templateUrl:'./child.html',inputs:{label:input<string>({required:true})},setup(c){calls.push('child:setup');return{label:c.inputs.label,click:()=>{clicks++;}}},onMount(){calls.push('child:mount');},onDestroy(){calls.push('child:destroy');},onBeforeUpdate(){calls.push('child:before');},onUpdated(){calls.push('child:after');}});
  export const Panel=defineComponent({selector:'conditional-panel',components:[Child],onBeforeUpdate(){calls.push('parent:before');},onUpdated(){calls.push('parent:after');},setup(){return{visible:signal(false),inner:signal(true),label:signal('first'),click:()=>{clicks++;}}}});`,
    );
    await writeFile(join(directory, 'child.html'), '<button @click="click()">{{ label }}</button>');
    await writeFile(
      join(directory, 'panel.html'),
      '<main><template when="visible"><section ref="branch"><button class="outer" @click="click()">outer</button><template when="inner"><branch-child :label="label"></branch-child><span>{{ label }}</span></template></section></template></main>',
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'panel.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'panel.mjs')).href)) as {
      Panel: ReturnType<typeof defineComponent>;
      calls: string[];
      clicks: number;
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement;
    const instance = mountComponent(host, module.Panel),
      state = instance.exposed as {
        visible: WritableSignal<boolean>;
        inner: WritableSignal<boolean>;
        label: WritableSignal<string>;
      };
    await nextTick();
    assert.equal(host.querySelector('section'), null);
    assert.deepEqual(module.calls, []);
    state.visible.set(true);
    await nextTick();
    assert.equal(host.querySelector('span')!.textContent, 'first');
    assert.deepEqual(module.calls, ['parent:before', 'child:setup', 'child:mount', 'parent:after']);
    const button = host.querySelector('branch-child button')!,
      outer = host.querySelector('.outer')!;
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    outer.dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(module.clicks, 2);
    module.calls.length = 0;
    state.label.set('second');
    await nextTick();
    assert.equal(host.querySelector('span')!.textContent, 'second');
    assert.equal(button.textContent, 'second');
    assert.deepEqual(module.calls, [
      'parent:before',
      'child:before',
      'child:after',
      'parent:after',
    ]);
    module.calls.length = 0;
    state.visible.set(false);
    await nextTick();
    assert.equal(host.querySelector('section'), null);
    assert.deepEqual(module.calls, ['parent:before', 'child:destroy', 'parent:after']);
    assert.equal(instance.owner.children.size, 0);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    outer.dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(module.clicks, 2);
    state.label.set('hidden');
    await nextTick();
    assert.equal(host.querySelector('section'), null);
    state.inner.set(false);
    state.visible.set(true);
    await nextTick();
    assert.ok(host.querySelector('section'));
    assert.equal(host.querySelector('branch-child'), null);
    instance.deactivate();
    state.inner.set(true);
    await nextTick();
    assert.equal(host.querySelector('branch-child'), null);
    instance.activate();
    await nextTick();
    assert.equal(host.querySelector('branch-child button')!.textContent, 'hidden');
    assert.notEqual(host.querySelector('branch-child button'), button);
    instance.dispose();
    assert.equal(instance.owner.children.size, 0);
    assert.equal(host.childNodes.length, 0);
  }));

test('each checks collections, stable key types and readonly item expressions', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'list.ts'),
      code = `import {defineComponent,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';export const List=defineComponent({selector:'typed-list',setup(){return{rows:signal([{id:1,title:'row'}]),count:signal(1)}}});`;
    await writeFile(entry, code);
    await writeFile(
      join(directory, 'list.html'),
      '<template each="row of rows"><p>{{ row.title }}</p></template>',
    );
    await assert.rejects(compileViews(code, entry), /each requires.*key/);
    await writeFile(
      join(directory, 'list.html'),
      '<template each="row of count" key="row"><p>invalid list</p></template>',
    );
    await assert.rejects(compileViews(code, entry), /list.html:1:.*number/);
    await writeFile(
      join(directory, 'list.html'),
      '<template each="row of rows" key="row"><p>{{ row.missing }}</p><input model:value="row.title" /></template>',
    );
    await assert.rejects(compileViews(code, entry), (error) => {
      const message = String(error);
      assert.match(message, /list.html:1:.*string \| number/);
      assert.match(message, /missing/);
      assert.match(message, /ReadSignal/);
      return true;
    });
  }));

test('keyed each reuses nodes and local component state, rejects duplicate keys and releases removed rows', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'list.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal,input} from '@xiaobaibaifqy/jingchuanchu-app/application';
  export const destroyed:string[]=[];export let constructed=0;
  const Row=defineComponent({selector:'list-row',templateUrl:'./row.html',inputs:{title:input<string>({required:true})},setup(c){constructed++;const count=signal(0);return{title:c.inputs.title,count,increment:()=>count.update(n=>n+1)}},onDestroy(c){destroyed.push(c.inputs.title());}});
  export const List=defineComponent({selector:'keyed-list',components:[Row],setup(){return{rows:signal([{id:1,title:'one',visible:true},{id:2,title:'two',visible:true}])}}});`,
    );
    await writeFile(
      join(directory, 'row.html'),
      '<button @click="increment()">{{ title }}:{{ count }}</button>',
    );
    await writeFile(
      join(directory, 'list.html'),
      '<main><template each="row of rows" key="row.id"><article :data-id="row.id"><template when="row.visible"><list-row :title="row.title"></list-row><span>{{ row.title }}</span></template></article></template><footer>tail</footer></main>',
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'list.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'list.mjs')).href)) as {
      List: ReturnType<typeof defineComponent>;
      destroyed: string[];
      constructed: number;
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement,
      errors: unknown[] = [];
    const instance = mountComponent(host, module.List, { onError: (error) => errors.push(error) }),
      rows = (
        instance.exposed as {
          rows: WritableSignal<{ id: number; title: string; visible: boolean }[]>;
        }
      ).rows;
    await nextTick();
    assert.equal(module.constructed, 2);
    const one = host.querySelector('[data-id="1"]')!,
      two = host.querySelector('[data-id="2"]')!,
      button = one.querySelector('button')!;
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    await nextTick();
    assert.equal(button.textContent, 'one:1');
    rows.set([
      { id: 2, title: 'second', visible: true },
      { id: 1, title: 'first', visible: true },
    ]);
    await nextTick();
    assert.deepEqual([...host.querySelectorAll('article')], [two, one]);
    assert.equal(one.querySelector('button'), button);
    assert.equal(button.textContent, 'first:1');
    assert.equal(module.constructed, 2);
    assert.deepEqual(module.destroyed, []);
    rows.set([
      { id: 1, title: 'duplicate', visible: true },
      { id: 1, title: 'duplicate-again', visible: true },
    ]);
    await nextTick();
    assert.equal(errors.length, 1);
    assert.match(String((errors[0] as Error).cause), /Duplicate each key: 1/);
    assert.deepEqual([...host.querySelectorAll('article')], [two, one]);
    assert.equal(module.constructed, 2);
    rows.set([{ id: 2, title: 'remaining', visible: true }]);
    await nextTick();
    assert.equal(host.querySelector('article'), two);
    assert.deepEqual(module.destroyed, ['first']);
    assert.equal(instance.owner.children.size, 1);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    await nextTick();
    assert.equal(button.textContent, 'first:1');
    rows.set([
      { id: 2, title: 'remaining', visible: false },
      { id: 3, title: 'new', visible: true },
    ]);
    await nextTick();
    assert.equal(two.querySelector('button'), null);
    assert.equal(module.constructed, 3);
    assert.deepEqual(module.destroyed, ['first', 'remaining']);
    rows.set([]);
    await nextTick();
    assert.equal(host.querySelector('article'), null);
    assert.equal(host.querySelector('footer')!.textContent, 'tail');
    assert.equal(instance.owner.children.size, 0);
    assert.deepEqual(module.destroyed, ['first', 'remaining', 'new']);
    instance.dispose();
    assert.equal(host.childNodes.length, 0);
  }));

test('slot names and projected expressions are checked in their declaring parent scope', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'slot.ts'),
      code = `import {defineComponent} from '@xiaobaibaifqy/jingchuanchu-app/application';const Child=defineComponent({selector:'slot-child',templateUrl:'./child.html',setup(){return{privateValue:'child'}}});export const Parent=defineComponent({selector:'slot-parent',components:[Child],setup(){return{caption:'parent'}}});`;
    await writeFile(entry, code);
    await writeFile(join(directory, 'child.html'), '<slot name="actions">fallback</slot>');
    await writeFile(
      join(directory, 'slot.html'),
      '<slot-child>\n<template slot="actions">{{ privateValue }}</template>\n</slot-child>',
    );
    await assert.rejects(compileViews(code, entry), /slot.html:2:.*privateValue/);
    await writeFile(
      join(directory, 'slot.html'),
      '<slot-child><template slot="actions">one</template><template slot="actions">two</template></slot-child>',
    );
    await assert.rejects(compileViews(code, entry), /duplicate projected slot/);
    await writeFile(join(directory, 'slot.html'), '<slot :name="caption">dynamic</slot>');
    await assert.rejects(compileViews(code, entry), /Slot names must be static/);
  }));

test('named slots use parent scope/registry, replace fallback and release projected components on exit', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'slot.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal} from '@xiaobaibaifqy/jingchuanchu-app/application';
  export const destroyed:string[]=[];export let clicks=0;export let privateRefsBlocked=0;
  const Action=defineComponent({selector:'parent-action',templateUrl:'./action.html',setup(){return{click:()=>{clicks++;}}},onDestroy(){destroyed.push('action');}});
  const Fallback=defineComponent({selector:'fallback-action',templateUrl:'./fallback.html',onDestroy(){destroyed.push('fallback');}});
  const Child=defineComponent({selector:'slot-child',templateUrl:'./child.html',components:[Fallback],setup(){return{caption:signal('child')}},onMount(c){try{c.element('private');}catch{privateRefsBlocked++;}}});
  export const Parent=defineComponent({selector:'slot-parent',components:[Child,Action],setup(){return{visible:signal(true),caption:signal('parent'),click:()=>{clicks++;}}}});`,
    );
    await writeFile(
      join(directory, 'action.html'),
      '<button ref="private" @click="click()">action</button>',
    );
    await writeFile(join(directory, 'fallback.html'), '<i ref="private">default component</i>');
    await writeFile(
      join(directory, 'child.html'),
      '<section><h2>{{ caption }}</h2><slot name="actions"><fallback-action></fallback-action><span>fallback {{ caption }}</span></slot></section>',
    );
    await writeFile(
      join(directory, 'slot.html'),
      '<main><template when="visible"><slot-child class="provided"><template slot="actions"><b>{{ caption }}</b><parent-action></parent-action><button class="lexical" @click="click()">{{ caption }}</button></template></slot-child><slot-child class="default"></slot-child></template></main>',
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'slot.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'slot.mjs')).href)) as {
      Parent: ReturnType<typeof defineComponent>;
      destroyed: string[];
      clicks: number;
      privateRefsBlocked: number;
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement;
    const instance = mountComponent(host, module.Parent),
      state = instance.exposed as {
        visible: WritableSignal<boolean>;
        caption: WritableSignal<string>;
      };
    await nextTick();
    assert.equal(host.querySelector('.provided b')!.textContent, 'parent');
    assert.equal(host.querySelector('.provided h2')!.textContent, 'child');
    assert.equal(host.querySelector('.provided fallback-action'), null);
    assert.equal(host.querySelector('.default span')!.textContent, 'fallback child');
    assert.equal(host.querySelectorAll('fallback-action').length, 1);
    assert.equal(module.privateRefsBlocked, 2);
    const button = host.querySelector('.provided .lexical')!,
      action = host.querySelector('.provided parent-action button')!;
    state.caption.set('updated');
    await nextTick();
    assert.equal(host.querySelector('.provided b')!.textContent, 'updated');
    assert.equal(button.textContent, 'updated');
    assert.equal(host.querySelector('.provided h2')!.textContent, 'child');
    action.dispatchEvent(new window.Event('click') as unknown as Event);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(module.clicks, 2);
    instance.deactivate();
    action.dispatchEvent(new window.Event('click') as unknown as Event);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(module.clicks, 2);
    instance.activate();
    await nextTick();
    state.visible.set(false);
    await nextTick();
    assert.equal(host.querySelector('section'), null);
    assert.deepEqual(module.destroyed.sort(), ['action', 'fallback']);
    assert.equal(instance.owner.children.size, 0);
    action.dispatchEvent(new window.Event('click') as unknown as Event);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(module.clicks, 2);
    instance.dispose();
    assert.equal(host.childNodes.length, 0);
  }));
