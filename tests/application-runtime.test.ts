import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineApplication,
  mountApplication,
  bootstrapApplication,
  ApplicationError,
  defineComponent,
  defineService,
  provideService,
  defineStore,
  signal,
  input,
  nextTick,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function dom() {
  const window = new Window(),
    document = window.document as unknown as Document;
  return { window, document, host: document.createElement('div') };
}

test('one shared application definition mounts isolated services/Stores and preserves typed root inputs', async () => {
  let created = 0,
    closed = 0;
  const Config = defineService({
    name: 'config',
    factory(context) {
      context.own(() => {
        closed++;
      });
      return { id: ++created };
    },
  });
  const Game = defineStore({
    name: 'game',
    setup() {
      const count = signal(1);
      return { state: { count }, getters: {}, actions: { add: () => count.update((n) => n + 1) } };
    },
  });
  const Root = defineComponent({
    selector: 'app-shell',
    inputs: { label: input<string>({ required: true }) },
    $template: '<h1>{{ label }}</h1><p>{{ count }}</p>',
    $bindings: [
      {
        path: [0, 0],
        kind: 'text',
        name: '0',
        source: 'app-shell.html:1',
        evaluate: (scope) => scope.label,
      },
      {
        path: [1, 0],
        kind: 'text',
        name: '0',
        source: 'app-shell.html:1',
        evaluate: (scope) => scope.count,
      },
    ],
    setup(context) {
      const game = context.useStore(Game);
      return {
        label: context.inputs.label,
        count: game.state.count,
        add: game.actions.add,
        config: context.useService(Config),
      };
    },
  });
  const initial = { label: 'start' },
    definition = defineApplication({
      root: Root,
      inputs: initial,
      providers: [provideService(Config)],
    });
  initial.label = 'changed';
  const { host, document } = dom(),
    other = document.createElement('div'),
    one = await mountApplication(host, definition),
    two = await mountApplication(other, definition);
  await nextTick();
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(host.querySelector('h1')!.textContent, 'start');
  assert.notEqual(one.root.exposed.config, two.root.exposed.config);
  assert.equal(created, 2);
  assert.equal(one.state(), 'running');
  assert.equal('set' in one.state, false);
  one.root.exposed.add();
  await nextTick();
  assert.equal(host.querySelector('p')!.textContent, '2');
  assert.equal(other.querySelector('p')!.textContent, '1');
  const before = host.innerHTML;
  await assert.rejects(mountApplication(host, definition), /already mounted/);
  assert.equal(host.innerHTML, before);
  assert.equal(created, 2);
  one.dispose();
  assert.equal(one.state(), 'disposed');
  assert.equal(host.childNodes.length, 0);
  assert.equal(closed, 1);
  assert.equal(two.state(), 'running');
  one.dispose();
  const again = await mountApplication(host, definition);
  assert.equal(created, 3);
  again.dispose();
  two.dispose();
  assert.equal(closed, 3);
});

test('service and root mounting failures reclaim resources/listeners and restore the original host for retry', async () => {
  let stage: 'service' | 'mount' | 'none' = 'service',
    cleaned = 0,
    clicks = 0;
  const errors: ApplicationError[] = [],
    buttons: Element[] = [];
  const Connection = defineService({
    name: 'connection',
    factory(context) {
      context.own(() => {
        cleaned++;
      });
      if (stage === 'service') throw new Error('offline');
      return {};
    },
  });
  const Root = defineComponent({
    selector: 'retry-app',
    $template: '<button ref="button">go</button>',
    setup(context) {
      context.useService(Connection);
      return {};
    },
    onMount(context) {
      const button = context.element('button');
      buttons.push(button);
      context.on('button', 'click', () => {
        clicks++;
      });
      if (stage === 'mount') throw new Error('mount failed');
    },
  });
  const definition = defineApplication({
      root: Root,
      providers: [provideService(Connection)],
      onError: (error) => {
        errors.push(error);
      },
    }),
    { host, window } = dom();
  host.innerHTML = '<em>original</em>';
  await assert.rejects(mountApplication(host, definition), /offline/);
  assert.equal(cleaned, 1);
  assert.equal(host.innerHTML, '<em>original</em>');
  stage = 'mount';
  await assert.rejects(mountApplication(host, definition), /mount failed/);
  assert.equal(cleaned, 2);
  assert.equal(host.innerHTML, '<em>original</em>');
  buttons[0]!.dispatchEvent(new window.Event('click') as unknown as Event);
  assert.equal(clicks, 0);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error instanceof ApplicationError));
  stage = 'none';
  const app = await mountApplication(host, definition);
  host.querySelector('button')!.dispatchEvent(new window.Event('click') as unknown as Event);
  assert.equal(clicks, 1);
  app.dispose();
  assert.equal(cleaned, 3);
  assert.equal(host.innerHTML, '<em>original</em>');
});

test('failed teardown still releases the host and makes repeated disposal safe', async () => {
  let fail = true,
    released = 0;
  const errors: ApplicationError[] = [];
  const Service = defineService({
    name: 'teardown',
    factory(context) {
      context.own(() => {
        released++;
        if (fail) throw new Error('service close');
      });
      return {};
    },
  });
  const Root = defineComponent({
    selector: 'teardown-app',
    $template: '<p>app</p>',
    setup(context) {
      context.useService(Service);
      return {};
    },
    onDestroy() {
      if (fail) throw new Error('view close');
    },
  });
  const definition = defineApplication({
      root: Root,
      providers: [provideService(Service)],
      onError: (error) => {
        errors.push(error);
      },
    }),
    { host } = dom(),
    app = await mountApplication(host, definition);
  assert.throws(
    () => app.dispose(),
    (error) =>
      error instanceof ApplicationError &&
      error.operation === 'dispose' &&
      error.cause instanceof AggregateError,
  );
  assert.equal(released, 1);
  assert.equal(app.state(), 'disposed');
  assert.equal(errors.length, 1);
  assert.equal(host.childNodes.length, 0);
  app.dispose();
  fail = false;
  const retry = await mountApplication(host, definition);
  retry.dispose();
  assert.equal(released, 2);
});

test('bootstrap uses the injected document and requires exactly one root selector match', async () => {
  let constructed = 0;
  const Root = defineComponent({
      selector: 'bootstrap-app',
      $template: '<p>ready</p>',
      setup() {
        constructed++;
        return {};
      },
    }),
    definition = defineApplication({ root: Root }),
    { document } = dom();
  await assert.rejects(bootstrapApplication(definition, { document }), /found 0/);
  document.body.innerHTML = '<bootstrap-app></bootstrap-app><bootstrap-app></bootstrap-app>';
  await assert.rejects(bootstrapApplication(definition, { document }), /found 2/);
  assert.equal(constructed, 0);
  document.body.lastElementChild!.remove();
  const app = await bootstrapApplication(definition, { document });
  assert.equal(constructed, 1);
  assert.equal(document.querySelector('bootstrap-app')!.textContent, 'ready');
  app.dispose();
});

test('asynchronous error observer failure is reported once without recursively invoking the observer', async () => {
  const reports: unknown[] = [],
    previous = globalThis.reportError;
  globalThis.reportError = (error) => reports.push(error);
  let observed = 0;
  try {
    const Root = defineComponent({
      selector: 'error-app',
      $template: '<button ref="button">go</button>',
      onMount(context) {
        context.on('button', 'click', async () => {
          throw new Error('event failed');
        });
      },
    });
    const definition = defineApplication({
        root: Root,
        async onError(error) {
          observed++;
          assert.ok(error instanceof ApplicationError);
          assert.equal(error.source, 'error-app');
          assert.equal(error.operation, 'event:click');
          await Promise.resolve();
          throw new Error('observer failed');
        },
      }),
      { host, window } = dom(),
      app = await mountApplication(host, definition);
    host.querySelector('button')!.dispatchEvent(new window.Event('click') as unknown as Event);
    await settle();
    assert.equal(observed, 1);
    assert.equal(reports.length, 1);
    assert.ok(reports[0] instanceof AggregateError);
    assert.ok((reports[0] as AggregateError).errors[0] instanceof ApplicationError);
    assert.match(String((reports[0] as AggregateError).errors[1]), /observer failed/);
    app.dispose();
  } finally {
    globalThis.reportError = previous;
  }
});
