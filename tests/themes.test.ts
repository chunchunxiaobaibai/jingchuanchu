import assert from 'node:assert/strict';
import test from 'node:test';
import { defineTheme, extendTheme, ThemeError } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ThemeOverrides,
  ThemeTokens,
  ThemeAssets,
} from '../packages/app/runtime/theme-types.js';

test('theme snapshots tokens/frames and replaces atlas assets as a whole without mutating the default', () => {
  const tokens = { accent: '#123456', spacing: 8 },
    frame = { x: 0, y: 0, width: 16, height: 16 };
  const base = defineTheme({
    name: 'base',
    tokens,
    assets: {
      'ui.pause': { kind: 'image', src: '/pause.png' },
      'game.coin': { kind: 'atlas-region', src: '/sheet.png', frame },
    },
  });
  tokens.accent = '#bad';
  frame.width = 99;
  assert.equal(base.tokens.accent, '#123456');
  const original = base.assets['game.coin'];
  assert.equal(original.kind, 'atlas-region');
  if (original.kind === 'atlas-region') assert.equal(original.frame.width, 16);
  const next = extendTheme(base, {
    name: 'forest',
    tokens: { accent: '#176b58' },
    assets: { 'game.coin': { kind: 'image', src: '/coin.png' } },
  });
  assert.deepEqual(next.assets['game.coin'], { kind: 'image', src: '/coin.png' });
  assert.equal(Object.hasOwn(next.assets['game.coin'], 'frame'), false);
  assert.equal(next.assets['ui.pause'], base.assets['ui.pause']);
  assert.equal(next.tokens.spacing, 8);
  assert.equal(base.tokens.accent, '#123456');
  assert.equal(next.defaultAssets['game.coin'], original);
  assert.ok(Object.isFrozen(next.assets['game.coin']));
});

test('multi-level themes inherit selected values while keeping the original resource fallback table', () => {
  const base = defineTheme({
    name: 'base',
    tokens: { accent: 'red', size: 1 },
    assets: { icon: { kind: 'image', src: '/base.png' } },
  });
  const one = extendTheme(base, {
    name: 'one',
    tokens: { size: 2 },
    assets: { icon: { kind: 'image', src: '/one.png' } },
  });
  const two = extendTheme(one, { name: 'two', tokens: { accent: 'blue' } });
  assert.deepEqual(two.tokens, { accent: 'blue', size: 2 });
  assert.equal(two.assets.icon.src, '/one.png');
  assert.equal(two.defaultAssets.icon.src, '/base.png');
  assert.equal(two.defaultAssets, base.defaultAssets);
});

test('invalid keys, token categories and frame shapes fail with theme/key/operation source', () => {
  const base = defineTheme({
    name: 'base',
    tokens: { accent: 'red', size: 1 },
    assets: { icon: { kind: 'image', src: '/base.png' } },
  });
  const invalid = [
    { name: 'unknown', tokens: { extra: 'red' } },
    { name: 'category', tokens: { size: 'large' } },
    { name: 'asset', assets: { missing: { kind: 'image', src: '/missing.png' } } },
    {
      name: 'frame',
      assets: {
        icon: {
          kind: 'atlas-region',
          src: '/sheet.png',
          frame: { x: 0, y: 0, width: 0, height: 1 },
        },
      },
    },
  ];
  for (const overrides of invalid)
    assert.throws(
      () =>
        extendTheme(
          base,
          overrides as unknown as ThemeOverrides<typeof base.tokens, typeof base.assets>,
        ),
      (error) =>
        error instanceof ThemeError &&
        error.theme === overrides.name &&
        error.operation === 'extend' &&
        error.key !== '<theme>',
    );
  assert.throws(
    () => defineTheme({ name: 'bad', tokens: { size: Infinity }, assets: {} }),
    /finite number/,
  );
  assert.throws(
    () => defineTheme({ name: 'bad', tokens: { 'bad.key': 'red' }, assets: {} }),
    /CSS identifier/,
  );
  assert.throws(
    () => defineTheme({ name: 'bad', tokens: {}, assets: { icon: { kind: 'image', src: '' } } }),
    /nonempty/,
  );
  const broad: import('../packages/app/runtime/theme-types.js').ThemeDefinition<
    ThemeTokens,
    ThemeAssets
  > = base;
  assert.equal(broad.tokens.size, 1);
});
