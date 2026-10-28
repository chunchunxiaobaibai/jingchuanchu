import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Window } from 'happy-dom';
import {
  defineComponent,
  definePage,
  mountComponent,
  RouterOutlet,
  defineRoutes,
  createRouter,
  createMemoryHistoryDriver,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { resolveRouteOutlet, getRouteOutlet } from '../packages/app/runtime/router/outlets.js';
import { createDOMRouteRenderer } from '../packages/app/runtime/router/dom-renderer.js';
import { compileViews } from '../packages/tooling/compiler.mjs';

function host() {
  const document = new Window().document as unknown as Document;
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

test('outlets resolve per page/root and own routed pages, including destruction through the outlet', async () => {
  let cleaned = 0;
  const PrivatePage = definePage({
    selector: 'private-page',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const Root = defineComponent({
    selector: 'outlet-root',
    components: [RouterOutlet, PrivatePage],
    $template: '<private-page></private-page><router-outlet></router-outlet>',
  });
  const firstHost = host(),
    secondHost = host();
  const first = mountComponent(firstHost, Root),
    second = mountComponent(secondHost, Root);
  const registration = resolveRouteOutlet(first.owner);
  const privateOutlet = firstHost.querySelector('private-page router-outlet')!;
  assert.notEqual(registration.host, privateOutlet);
  assert.equal(registration.host, firstHost.lastElementChild);
  assert.notEqual(resolveRouteOutlet(second.owner).host, registration.host);
  const Leaf = definePage({
    selector: 'owned-leaf',
    $template: '<button>leaf</button>',
    setup(c) {
      c.own(() => {
        cleaned++;
      });
      return {};
    },
  });
  const renderer = createDOMRouteRenderer(registration.host, first.owner);
  const router = createRouter({
    routes: defineRoutes([{ path: '/', page: Leaf }]),
    history: createMemoryHistoryDriver('/'),
    renderer,
  });
  assert.equal((await router.replace('/')).status, 'committed');
  assert.equal(registration.owner.children.size, 1);
  assert.equal(privateOutlet.childNodes.length, 0);
  registration.owner.dispose();
  assert.equal(cleaned, 1);
  assert.equal(getRouteOutlet(registration.host), undefined);
  assert.throws(() => resolveRouteOutlet(first.owner), /found 0/);
  assert.ok(resolveRouteOutlet(second.owner));
  router.dispose();
  first.dispose();
  second.dispose();
  assert.equal(firstHost.childNodes.length, 0);
  assert.equal(secondHost.childNodes.length, 0);
});

test('unregistered lookalikes and multiple live outlets reject nested candidates while retaining the old page', async () => {
  const Root = defineComponent({
    selector: 'outlet-root',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet>',
  });
  const element = host(),
    root = mountComponent(element, Root);
  const renderer = createDOMRouteRenderer(resolveRouteOutlet(root.owner).host, root.owner);
  const Leaf = definePage({ selector: 'outlet-leaf', $template: '<p>old</p>' });
  const Lookalike = definePage({
    selector: 'lookalike-layout',
    $template: '<router-outlet></router-outlet>',
  });
  const Duplicate = definePage({
    selector: 'duplicate-layout',
    components: [RouterOutlet],
    $template: '<router-outlet></router-outlet><router-outlet></router-outlet>',
  });
  const router = createRouter({
    routes: defineRoutes([
      { path: '/', page: Leaf },
      { path: '/lookalike', page: Lookalike, children: [{ path: 'child', page: Leaf }] },
      { path: '/duplicate', page: Duplicate, children: [{ path: 'child', page: Leaf }] },
    ]),
    history: createMemoryHistoryDriver('/'),
    renderer,
  });
  await router.replace('/');
  const old = element.querySelector('outlet-leaf');
  for (const path of ['/lookalike/child', '/duplicate/child']) {
    assert.equal((await router.push(path)).status, 'failed');
    assert.equal(element.querySelector('outlet-leaf'), old);
    assert.equal(resolveRouteOutlet(root.owner).owner.children.size, 1);
  }
  router.dispose();
  root.dispose();
});

test('the template compiler accepts an explicitly registered public RouterOutlet and rejects an undeclared outlet', async () => {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/router-outlet-'));
  try {
    const file = join(directory, 'shell.ts');
    const source =
      "import {defineComponent,RouterOutlet} from '@xiaobaibaifqy/jingchuanchu-app/application'; export const Shell=defineComponent({selector:'app-shell',components:[RouterOutlet]});";
    await writeFile(file, source);
    await writeFile(join(directory, 'shell.html'), '<main><router-outlet></router-outlet></main>');
    const compiled = await compileViews(source, file);
    assert.ok(compiled);
    assert.ok(compiled.code.includes('$template:'));
    await assert.rejects(
      compileViews(source.replace('components:[RouterOutlet]', 'components:[]'), file),
      /router-outlet/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
