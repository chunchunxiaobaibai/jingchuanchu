import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Window } from 'happy-dom';
import {
  RouteLink,
  definePage,
  defineRoutes,
  createRouter,
  createMemoryHistoryDriver,
  mountComponent,
  nextTick,
  type NavigationResult,
  type ComponentDefinition,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { InputMap, OutputMap, ModelMap } from '../packages/app/runtime/component-types.js';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { installRouterContext } from '../packages/app/runtime/router/context.js';
import { compileViews } from '../packages/tooling/compiler.mjs';

function fixture() {
  const window = new Window({ url: 'https://example.test/shell/' });
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  const page = definePage({ selector: 'link-page', $template: '<p>page</p>' });
  const memory = createMemoryHistoryDriver('/');
  const router = createRouter({
    routes: defineRoutes([
      { name: 'home', path: '/', page },
      { name: 'next', path: '/next/:id', page },
      { path: '/blocked', page, guards: [() => ({ status: 'deny' })] },
    ]),
    history: { ...memory, createHref: (path) => '/app' + path },
    renderer: { create: () => ({ commit: () => () => {}, dispose() {} }) },
  });
  const owner = new ComponentOwner();
  installRouterContext(owner, router);
  return { window, host, owner, memory, router };
}
const settle = async () => {
  await new Promise<void>((done) => setImmediate(done));
  await nextTick();
};

test('RouteLink resolves named targets, emits results and updates href/current/replace', async () => {
  const { window, host, owner, memory, router } = fixture();
  const results: NavigationResult[] = [];
  const link = mountComponent(host, RouteLink, {
    owner,
    inputs: { to: { name: 'next', params: { id: 'one' }, query: { q: 'a b' }, hash: 'panel' } },
    outputs: { navigated: (result) => results.push(result) },
  });
  const anchor = host.querySelector('a')!;
  const click = () =>
    anchor.dispatchEvent(
      new window.MouseEvent('click', { button: 0, cancelable: true }) as unknown as Event,
    );
  assert.equal(anchor.getAttribute('href'), '/app/next/one?q=a+b#panel');
  assert.equal(memory.read().position, 0);
  assert.equal(click(), false);
  await settle();
  assert.equal(results[0]!.status, 'committed');
  assert.equal(memory.read().position, 1);
  assert.equal(anchor.getAttribute('aria-current'), 'page');
  link.setInputs({ to: '/blocked', replace: true });
  await nextTick();
  assert.equal(anchor.getAttribute('aria-current'), null);
  click();
  await settle();
  assert.equal(results[1]!.status, 'denied');
  assert.equal(memory.read().position, 1);
  link.setInputs({ to: '/' });
  await nextTick();
  click();
  await settle();
  assert.equal(router.current()!.fullPath, '/');
  assert.equal(memory.read().position, 1);
  assert.throws(() => router.href('https://other.test/'), /Route/);
  link.dispose();
  router.dispose();
  owner.dispose();
});

test('RouteLink preserves native gestures/download/target and removes its handler on disposal', async () => {
  const { window, host, owner, memory, router } = fixture();
  const link = mountComponent(host, RouteLink, { owner, inputs: { to: '/next/one' } });
  const anchor = host.querySelector('a')!;
  let intercepted = false;
  // Observe the component, then suppress Happy DOM's default navigation in this Node test.
  anchor.addEventListener('click', (event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  });
  const click = (options = {}) =>
    anchor.dispatchEvent(
      new window.MouseEvent('click', {
        button: 0,
        cancelable: true,
        ...options,
      }) as unknown as Event,
    );
  click({ ctrlKey: true });
  assert.equal(intercepted, false);
  click({ button: 1 });
  assert.equal(intercepted, false);
  link.setInputs({ target: '_blank' });
  await nextTick();
  click();
  assert.equal(intercepted, false);
  link.setInputs({ target: '_self', download: '' });
  await nextTick();
  assert.equal(anchor.hasAttribute('download'), true);
  click();
  assert.equal(intercepted, false);
  link.setInputs({ download: null });
  await nextTick();
  assert.equal(anchor.hasAttribute('download'), false);
  link.dispose();
  click();
  assert.equal(intercepted, false);
  await settle();
  assert.equal(memory.read().position, 0);
  router.dispose();
  owner.dispose();
});

test('compiled RouteLink projects default slot content and checks its required target', async () => {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/router-link-'));
  const { host, owner, router } = fixture();
  try {
    const file = join(directory, 'shell.ts');
    const source =
      "import {defineComponent,RouteLink} from '@xiaobaibaifqy/jingchuanchu-app/application'; export const Shell=defineComponent({selector:'link-shell',components:[RouteLink]});";
    await writeFile(file, source);
    await writeFile(
      join(directory, 'shell.html'),
      '<route-link to="/next/one"><template slot="default"><strong>Play</strong></template></route-link>',
    );
    const compiled = (await compileViews(source, file))!;
    const modulePath = join(directory, 'compiled.mjs');
    await writeFile(
      modulePath,
      ts.transpileModule(compiled.code, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
    const module = (await import(pathToFileURL(modulePath).href)) as {
      Shell: ComponentDefinition<InputMap, OutputMap, ModelMap, Record<string, unknown>>;
    };
    const instance = mountComponent(host, module.Shell, { owner });
    assert.equal(host.querySelector('a strong')!.textContent, 'Play');
    assert.equal(host.querySelector('a')!.getAttribute('href'), '/app/next/one');
    instance.dispose();
    await writeFile(join(directory, 'shell.html'), '<route-link>Missing target</route-link>');
    await assert.rejects(compileViews(source, file), /to/);
  } finally {
    router.dispose();
    owner.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
