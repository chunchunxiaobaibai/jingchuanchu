import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { resource, type Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import {
  defineComponent,
  definePage,
  input,
  model,
  output,
  mountComponent,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner, type OwnerResolver } from '../packages/app/runtime/component-owner.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  return { host, document };
}

test('static parent/child instances obey lifecycle order and coalesce parent inputs', async () => {
  const { host } = dom(),
    calls: string[] = [];
  let change: unknown;
  const Child = defineComponent({
    selector: 'child-view',
    inputs: { label: input<string>({ required: true }) },
    $template: '<span ref="label">child</span>',
    setup(c) {
      calls.push('child:setup:' + c.inputs.label());
      return {};
    },
    onInit() {
      calls.push('child:init');
    },
    onMount(c) {
      assert.ok(c.element('label'));
      calls.push('child:mount');
    },
    onDestroy() {
      calls.push('child:destroy');
    },
  });
  const Parent = definePage({
    selector: 'parent-page',
    components: [Child],
    inputs: { name: input<string>({ default: 'initial' }) },
    $template: '<main ref="main"><child-view label="child input"></child-view></main>',
    setup() {
      calls.push('parent:setup');
      return {};
    },
    onInit(c) {
      assert.throws(() => c.element('main'), /before onMount/);
      calls.push('parent:init');
    },
    onMount() {
      calls.push('parent:mount');
    },
    onInputsChanged(_, value) {
      change = value;
      calls.push('parent:inputs');
    },
    onBeforeUpdate() {
      calls.push('before');
    },
    onUpdated() {
      calls.push('updated');
    },
    onDeactivate() {
      calls.push('off');
    },
    onActivate() {
      calls.push('on');
    },
    onDestroy(c) {
      assert.ok(c.element('main'));
      calls.push('parent:destroy');
    },
  });
  const instance = mountComponent(host, Parent);
  assert.deepEqual(calls, [
    'parent:setup',
    'parent:init',
    'child:setup:child input',
    'child:init',
    'child:mount',
    'parent:mount',
  ]);
  instance.setInputs({ name: 'middle' });
  instance.setInputs({ name: 'final' });
  await flush();
  assert.deepEqual(change, { previous: { name: 'initial' }, current: { name: 'final' } });
  assert.equal(calls.filter((value) => value === 'parent:inputs').length, 1);
  assert.ok(!calls.includes('before') && !calls.includes('updated')); // Static DOM did not change.
  instance.deactivate();
  instance.setInputs({ name: 'sleeping' });
  await flush();
  assert.equal(calls.filter((value) => value === 'parent:inputs').length, 1);
  instance.activate();
  await flush();
  assert.equal(calls.filter((value) => value === 'parent:inputs').length, 2);
  instance.dispose();
  instance.dispose();
  assert.ok(calls.indexOf('child:destroy') < calls.indexOf('parent:destroy'));
  assert.equal(host.childNodes.length, 0);
  assert.throws(() => instance.setInputs({ name: 'late' }), /disposed/);
});

test('model ownership, outputs and object defaults are isolated per instance', async () => {
  const { host, document } = dom(),
    second = document.createElement('div'),
    target = signal('parent'),
    events: string[] = [];
  const Editor = defineComponent({
    selector: 'edit-view',
    models: {
      value: model<string>({ default: '' }),
      options: model<{ enabled: boolean }>({ default: () => ({ enabled: true }) }),
    },
    outputs: { save: output<string>() },
    $template: '<button ref="save">save</button>',
    setup(c) {
      return {
        value: c.models.value,
        options: c.models.options,
        save: () => c.emit('save', c.models.value()),
      };
    },
    onMount(c) {
      c.on('save', 'click', () => c.exposed.save());
    },
  });
  const a = mountComponent(host, Editor, {
      models: { value: target },
      outputs: { save: (value) => events.push(value) },
    }),
    b = mountComponent(second, Editor);
  a.exposed.value.set('changed');
  assert.equal(target(), 'changed');
  assert.equal(b.exposed.value(), '');
  a.exposed.options.set({ enabled: false });
  assert.equal(b.exposed.options().enabled, true);
  host.querySelector('button')!.dispatchEvent(new document.defaultView!.Event('click'));
  assert.deepEqual(events, ['changed']);
  assert.throws(() => a.setInputs({ value: 'bypass' }), /parent target/);
  a.dispose();
  b.dispose();
  assert.throws(() => a.exposed.value.set('late'), /disposed/);
  await flush();
});

test('a failing child destroy does not skip parent cleanup, cancellation or original host restoration', () => {
  const { host, document } = dom(),
    original = document.createElement('p');
  original.textContent = 'original';
  host.append(original);
  const calls: string[] = [];
  const Child = defineComponent({
    selector: 'child-view',
    $template: '<span></span>',
    onDestroy() {
      calls.push('child');
      throw new Error('child destruction');
    },
  });
  const Parent = defineComponent({
    selector: 'parent-view',
    components: [Child],
    $template: '<child-view></child-view>',
    onInit(c) {
      c.signal.subscribe(() => calls.push('cancel'));
      c.own(() => calls.push('cleanup'));
    },
    onDestroy() {
      calls.push('parent');
      throw new Error('parent destruction');
    },
  });
  const instance = mountComponent(host, Parent);
  assert.throws(() => instance.dispose(), AggregateError);
  assert.deepEqual(calls, ['child', 'parent', 'cancel', 'cleanup']);
  assert.strictEqual(host.firstChild, original);
  assert.equal(host.childNodes.length, 1);
  assert.equal(instance.owner.children.size, 0);
  assert.doesNotThrow(() => instance.dispose());
});

test('failed setup/mount/required inputs roll back the owner and leave the host reusable', () => {
  const { host } = dom(),
    owner = new ComponentOwner();
  let cleanups = 0;
  const Bad = defineComponent({
    selector: 'bad-view',
    $template: '<div></div>',
    setup(c) {
      c.own(() => cleanups++);
      throw new Error('setup failure');
    },
  });
  assert.throws(() => mountComponent(host, Bad, { owner }), /setup/);
  assert.equal(cleanups, 1);
  assert.equal(owner.children.size, 0);
  const Required = defineComponent({
    selector: 'required-view',
    inputs: { count: input<number>({ required: true }) },
    $template: '<div></div>',
  });
  assert.throws(() => mountComponent(host, Required, { owner }), /Missing required/);
  assert.equal(owner.children.size, 0);
  const Mounted = defineComponent({
    selector: 'mounted-view',
    $template: '<div></div>',
    onMount(c) {
      c.own(() => cleanups++);
      throw new Error('mount failure');
    },
  });
  assert.throws(() => mountComponent(host, Mounted, { owner }), /onMount/);
  assert.equal(cleanups, 2);
  assert.equal(owner.children.size, 0);
  const Good = defineComponent({ selector: 'good-view', $template: '<span>ok</span>' });
  mountComponent(host, Good, { owner });
  owner.dispose();
  assert.equal(host.childNodes.length, 0);
});

test('service lookup uses the explicit owner chain and parent disposal removes child event registrations', () => {
  const { host, document } = dom(),
    Service = resource<number>('counter');
  let clicks = 0;
  const resolver: OwnerResolver = {
    has: (token) => token.key === Service.key,
    resolve<T>(token: Token<T>): T {
      assert.equal(token.key, Service.key);
      return 4 as T;
    },
  };
  const owner = new ComponentOwner(undefined, { services: resolver });
  const View = defineComponent({
    selector: 'service-view',
    $template: '<button ref="button">go</button>',
    setup(c) {
      return { value: c.useService(Service) };
    },
    onMount(c) {
      c.on('button', 'click', () => clicks++);
    },
  });
  const instance = mountComponent(host, View, { owner });
  assert.equal(instance.exposed.value, 4);
  const button = host.querySelector('button')!;
  button.dispatchEvent(new document.defaultView!.Event('click'));
  assert.equal(clicks, 1);
  instance.deactivate();
  button.dispatchEvent(new document.defaultView!.Event('click'));
  assert.equal(clicks, 1);
  owner.dispose();
  button.dispatchEvent(new document.defaultView!.Event('click'));
  assert.equal(clicks, 1);
  assert.equal(host.childNodes.length, 0);
});

test('asynchronous event failures and a throwing error observer are reported once to the host', async () => {
  const { host, document } = dom(),
    reports: unknown[] = [];
  const original = globalThis.reportError;
  globalThis.reportError = (error) => reports.push(error);
  try {
    const View = defineComponent({
      selector: 'error-view',
      $template: '<button ref="button">go</button>',
      onMount(c) {
        c.on('button', 'click', async () => {
          throw new Error('event failure');
        });
      },
    });
    const instance = mountComponent(host, View, {
      onError() {
        throw new Error('observer failure');
      },
    });
    host.querySelector('button')!.dispatchEvent(new document.defaultView!.Event('click'));
    await flush();
    assert.equal(reports.length, 1);
    assert.ok(reports[0] instanceof AggregateError);
    assert.match(String((reports[0] as AggregateError).errors[0]), /event:click/);
    instance.dispose();
  } finally {
    globalThis.reportError = original;
  }
});
