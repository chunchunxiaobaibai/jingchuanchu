import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileViews } from '../packages/tooling/compiler.mjs';
import {
  defineTheme,
  extendTheme,
  defineComponent,
  defineApplication,
  mountApplication,
  type ThemeContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Base = defineTheme({
  name: 'base',
  tokens: { accent: 'red', spacing: 8 },
  assets: { icon: { kind: 'image', src: '/base.png' } },
});
const Forest = extendTheme(Base, {
  name: 'forest',
  tokens: { accent: 'green' },
  assets: { icon: { kind: 'image', src: '/forest.png' } },
});
function dom() {
  const document = new Window().document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  return { host, document };
}

test('application theme tokens/semantic resolution stay local and cleanup restores owned variables without overwriting unrelated style changes', async () => {
  const contexts: ThemeContext<typeof Base.tokens, typeof Base.assets>[] = [];
  const Root = defineComponent({
    selector: 'theme-app',
    $template: '<img ref="icon">',
    setup(c) {
      const theme = c.useTheme(Base);
      contexts.push(theme);
      return { asset: theme.resolve };
    },
    onMount(c) {
      c.element('icon').setAttribute('src', c.exposed.asset('icon').src);
    },
  });
  const { host, document } = dom(),
    second = document.createElement('div');
  document.body.append(second);
  host.style.setProperty('--jcc-accent', 'purple', 'important');
  host.style.setProperty('color', 'red');
  const first = await mountApplication(host, defineApplication({ root: Root, theme: Forest }));
  const other = await mountApplication(second, defineApplication({ root: Root, theme: Base }));
  assert.equal(host.style.getPropertyValue('--jcc-accent'), 'green');
  assert.equal(second.style.getPropertyValue('--jcc-accent'), 'red');
  assert.equal(host.style.getPropertyValue('--jcc-spacing'), '8');
  assert.equal(document.documentElement.style.getPropertyValue('--jcc-accent'), '');
  assert.equal(host.querySelector('img')!.getAttribute('src'), '/forest.png');
  assert.equal(second.querySelector('img')!.getAttribute('src'), '/base.png');
  assert.equal(first.useTheme(Base).tokens.accent, 'green');
  host.style.color = 'blue';
  first.dispose();
  assert.equal(host.style.getPropertyValue('--jcc-accent'), 'purple');
  assert.equal(host.style.getPropertyPriority('--jcc-accent'), 'important');
  assert.equal(host.style.getPropertyValue('--jcc-spacing'), '');
  assert.equal(host.style.color, 'blue');
  assert.throws(() => contexts[0]!.resolve('icon'), /owner is disposed/);
  assert.equal(contexts[1]!.resolve('icon').src, '/base.png');
  other.dispose();
  assert.equal(second.hasAttribute('style'), false);
});

test('failed root startup rolls back token styles and a theme context rejects another default family', async () => {
  const Root = defineComponent({
    selector: 'broken-theme-app',
    $template: '',
    setup() {
      throw new Error('root startup failed');
    },
  });
  const { host } = dom();
  host.style.setProperty('--jcc-spacing', '12');
  host.innerHTML = '<em>original</em>';
  const original = host.firstChild;
  await assert.rejects(
    mountApplication(host, defineApplication({ root: Root, theme: Forest })),
    /root startup failed/,
  );
  assert.equal(host.style.getPropertyValue('--jcc-spacing'), '12');
  assert.equal(host.style.getPropertyValue('--jcc-accent'), '');
  assert.equal(host.firstChild, original);
  const Healthy = defineComponent({ selector: 'healthy-theme-app', $template: '' });
  const app = await mountApplication(host, defineApplication({ root: Healthy, theme: Forest }));
  const unrelated = defineTheme({
    name: 'other',
    tokens: { accent: 'blue', spacing: 8 },
    assets: { icon: { kind: 'image', src: '/other.png' } },
  });
  assert.throws(() => app.useTheme(unrelated), /different default contract/);
  app.dispose();
  assert.equal(host.firstChild, original);
  const bare = await mountApplication(host, defineApplication({ root: Healthy }));
  assert.throws(() => bare.useTheme(Base), /not configured/);
  bare.dispose();
});

test('template expressions preserve theme contract keys exposed through a bound resolver', async () => {
  await mkdir('dist/audit', { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/theme-template-'));
  try {
    const file = join(directory, 'theme-root.ts');
    const source = `import {defineTheme,defineComponent} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Default=defineTheme({name:'default',tokens:{accent:'red'},assets:{icon:{kind:'image',src:'/icon.png'}}});
export const Root=defineComponent({selector:'typed-theme-root',setup(c){const theme=c.useTheme(Default);return{asset:theme.resolve}}});`;
    await writeFile(file, source);
    await writeFile(join(directory, 'theme-root.html'), '<img :src="asset(\'icon\').src">');
    assert.ok(await compileViews(source, file));
    await writeFile(join(directory, 'theme-root.html'), '<img :src="asset(\'missing\').src">');
    await assert.rejects(compileViews(source, file), /theme-root.html:1:.*missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
