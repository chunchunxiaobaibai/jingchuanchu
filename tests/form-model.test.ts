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
  type WritableSignal,
  type ConvertedModel,
  type WritableModel,
  nextTick,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { compileViews } from '../packages/tooling/compiler.mjs';
import { jingchuanchu } from '../packages/tooling/vite.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
async function fixture(run: (directory: string) => Promise<void>) {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/form-model-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('select models follow dynamic options on initial mount and later option replacement without input events', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'select.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal,writableModel} from '@xiaobaibaifqy/jingchuanchu-app/application';
export const Select=defineComponent({selector:'dynamic-select',setup(){
  const value=signal('b'), selected=signal<string[]>(['b']), items=signal([{id:'a'},{id:'b'}]), later=signal<{id:string}[]>([]);
  const multi=writableModel({get:selected,set:(value:string[])=>selected.set(value),convert:'strings'});
  return {value,selected,multi,items,later};
}});`,
    );
    await writeFile(
      join(directory, 'select.html'),
      `<select id="single" model:value="value"><template each="item of items" key="item.id"><option :value="item.id">{{ item.id }}</option></template></select>
<select id="multiple" multiple model:value="multi"><template each="item of items" key="item.id"><option :value="item.id">{{ item.id }}</option></template></select>
<select id="later" model:value="value"><template each="item of later" key="item.id"><option :value="item.id">{{ item.id }}</option></template></select>`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'select.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'select.mjs')).href)) as {
      Select: ReturnType<typeof defineComponent>;
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement;
    const instance = mountComponent(host, module.Select);
    try {
      const state = instance.exposed as {
        value: WritableSignal<string>;
        selected: WritableSignal<string[]>;
        items: WritableSignal<{ id: string }[]>;
        later: WritableSignal<{ id: string }[]>;
      };
      const single = host.querySelector<HTMLSelectElement>('#single')!;
      const multiple = host.querySelector<HTMLSelectElement>('#multiple')!;
      const later = host.querySelector<HTMLSelectElement>('#later')!;
      let events = 0;
      host.addEventListener('input', () => events++);
      host.addEventListener('change', () => events++);
      const chosen = () => [...multiple.options].filter((o) => o.selected).map((o) => o.value);
      await nextTick();
      assert.equal(single.value, 'b');
      assert.deepEqual(chosen(), ['b']);
      state.later.set([{ id: 'a' }, { id: 'b' }]);
      await nextTick();
      assert.equal(later.value, 'b');
      state.items.set([{ id: 'c' }, { id: 'b' }]);
      await nextTick();
      assert.equal(single.value, 'b');
      assert.deepEqual(chosen(), ['b']);
      state.items.set([{ id: 'c' }]);
      await nextTick();
      assert.equal(single.value, '');
      assert.deepEqual(chosen(), []);
      state.items.set([{ id: 'b' }, { id: 'c' }]);
      await nextTick();
      assert.equal(single.value, 'b');
      assert.deepEqual(chosen(), ['b']);
      assert.equal(state.value(), 'b');
      assert.deepEqual(state.selected(), ['b']);
      assert.equal(events, 0);
      single.value = 'c';
      single.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
      await nextTick();
      assert.equal(state.value(), 'c');
      assert.equal(later.value, '');
      assert.equal(events, 1);
    } finally {
      instance.dispose();
      await window.happyDOM.close();
    }
  }));

test('template checking rejects readonly and incompatible native/custom model targets', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'form.ts');
    const code = `import {defineComponent,signal,computed,input,model} from '@xiaobaibaifqy/jingchuanchu-app/application';
  const Child=defineComponent({selector:'model-child',templateUrl:'./child.html',models:{value:model<number>({required:true})}});
  export const Form=defineComponent({selector:'model-form',components:[Child],inputs:{label:input<string>({default:''})},setup(c){return{readonlyValue:computed(()=>''),input:c.inputs.label,amount:signal(1),text:signal('')}}});`;
    await writeFile(entry, code);
    await writeFile(join(directory, 'child.html'), '<span>child</span>');
    await writeFile(
      join(directory, 'form.html'),
      `<input model:value="readonlyValue" />
<input model:value="input" />
<input model:value="amount" />
<input type="checkbox" model:checked="text" />
<model-child model:value="text"></model-child>`,
    );
    await assert.rejects(compileViews(code, entry), (error) => {
      const message = String(error);
      for (const line of [1, 2, 3, 4, 5]) assert.match(message, new RegExp(`form.html:${line}:`));
      return true;
    });
    await writeFile(join(directory, 'form.html'), '<input :value="text" model:value="text" />');
    await assert.rejects(compileViews(code, entry), /Conflicting property\/model/);
    await writeFile(join(directory, 'form.html'), '<input model:value="text()" />');
    await assert.rejects(compileViews(code, entry), /writable member path/);
  }));

test('native and custom models synchronize without input loops and preserve invalid/composition drafts', () =>
  fixture(async (directory) => {
    const entry = join(directory, 'form.ts');
    await writeFile(
      entry,
      `import {defineComponent,signal,model,writableModel} from '@xiaobaibaifqy/jingchuanchu-app/application';
  const Child=defineComponent({selector:'editor-child',templateUrl:'./child.html',models:{value:model<string>({required:true})},setup(c){return{value:c.models.value}}});
  export const updates:string[]=[];
  export const Form=defineComponent({selector:'model-form',components:[Child],onBeforeUpdate(){updates.push('before');},onUpdated(){updates.push('after');},setup(){
    const text=signal('before'),amount=signal(2),checked=signal(false),selected=signal<string[]>(['b']),delayed=signal('old');
    const numeric=writableModel({get:amount,set:(value:number)=>amount.set(value),convert:'number'});
    const multi=writableModel({get:selected,set:(value:string[])=>selected.set(value),convert:'strings'});
    const lazy=writableModel({get:delayed,set:(value:string)=>delayed.set(value),event:'change'});
    return{text,amount,numeric,checked,selected,multi,delayed,lazy};
  }});`,
    );
    await writeFile(join(directory, 'child.html'), '<input model:value="value" />');
    await writeFile(
      join(directory, 'form.html'),
      `<input id="text" model:value="text" /><input id="number" model:value="numeric" /><input id="check" type="checkbox" model:checked="checked" />
<select id="multi" multiple model:value="multi"><option value="a">A</option><option value="b">B</option></select>
<textarea id="lazy" model:value="lazy"></textarea><editor-child model:value="text"></editor-child><p>{{ text }}</p>`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'form.mjs' },
        rollupOptions: { external: ['@xiaobaibaifqy/jingchuanchu-app/application'] },
      },
    });
    const module = (await import(pathToFileURL(join(output, 'form.mjs')).href)) as {
      Form: ReturnType<typeof defineComponent>;
      updates: string[];
    };
    const window = new Window(),
      host = window.document.createElement('div') as unknown as HTMLElement;
    const instance = mountComponent(host, module.Form),
      state = instance.exposed as {
        text: WritableSignal<string>;
        amount: WritableSignal<number>;
        numeric: ConvertedModel<number>;
        checked: WritableSignal<boolean>;
        selected: WritableSignal<string[]>;
        delayed: WritableSignal<string>;
        lazy: WritableModel<string>;
      };
    const element = (id: string) => host.querySelector<HTMLInputElement>('#' + id)!;
    const dispatch = (node: Element, event: string) =>
      node.dispatchEvent(new window.Event(event, { bubbles: true }) as unknown as Event);
    await settle();
    assert.equal(element('text').value, 'before');
    assert.equal(element('number').value, '2');
    const child = host.querySelector<HTMLInputElement>('editor-child input')!;
    child.value = 'child';
    dispatch(child, 'input');
    await settle();
    assert.equal(state.text(), 'child');
    assert.equal(element('text').value, 'child');
    state.text.set('parent');
    await settle();
    assert.equal(child.value, 'parent');
    assert.equal(host.querySelector('editor-child input'), child);
    dispatch(element('text'), 'compositionstart');
    element('text').value = '中';
    dispatch(element('text'), 'input');
    assert.equal(state.text(), 'parent');
    state.text.set('external');
    await settle();
    assert.equal(element('text').value, '中');
    element('text').value = '中文';
    dispatch(element('text'), 'compositionend');
    dispatch(element('text'), 'input');
    await settle();
    assert.equal(state.text(), '中文');
    assert.equal(child.value, '中文');
    element('number').value = '';
    dispatch(element('number'), 'input');
    assert.equal(state.amount(), 2);
    assert.deepEqual(state.numeric.validation(), { valid: false, reason: 'empty-number' });
    state.text.set('unrelated');
    await settle();
    assert.equal(element('number').value, '');
    state.numeric.resetDraft();
    await settle();
    assert.equal(element('number').value, '2');
    element('number').value = 'abc';
    dispatch(element('number'), 'input');
    assert.deepEqual(state.numeric.validation(), { valid: false, reason: 'invalid-number' });
    state.amount.set(7);
    await settle();
    assert.equal(element('number').value, '7');
    assert.deepEqual(state.numeric.validation(), { valid: true });
    const beforeDraft = module.updates.length;
    element('number').value = '7.0';
    dispatch(element('number'), 'input');
    await settle();
    assert.equal(element('number').value, '7.0');
    assert.equal(module.updates.length, beforeDraft);
    state.numeric.resetDraft();
    await settle();
    assert.equal(element('number').value, '7');
    assert.equal(module.updates.length, beforeDraft + 2);
    element('check').checked = true;
    dispatch(element('check'), 'input');
    assert.equal(state.checked(), true);
    state.checked.set(false);
    await settle();
    assert.equal(element('check').checked, false);
    const select = host.querySelector<HTMLSelectElement>('#multi')!;
    assert.deepEqual(
      [...select.selectedOptions].map((o) => o.value),
      ['b'],
    );
    select.options[0]!.selected = true;
    dispatch(select, 'input');
    assert.deepEqual(state.selected(), ['a', 'b']);
    state.selected.set(['a']);
    await settle();
    assert.equal(select.options[1]!.selected, false);
    element('lazy').value = 'new';
    dispatch(element('lazy'), 'input');
    assert.equal(state.delayed(), 'old');
    dispatch(element('lazy'), 'change');
    assert.equal(state.delayed(), 'new');
    instance.deactivate();
    element('text').value = 'inactive';
    dispatch(element('text'), 'input');
    assert.equal(state.text(), 'unrelated');
    instance.activate();
    await settle();
    assert.equal(element('text').value, 'unrelated');
    instance.dispose();
    child.value = 'gone';
    dispatch(child, 'input');
    assert.equal(state.text(), 'unrelated');
    assert.equal(host.childNodes.length, 0);
  }));
