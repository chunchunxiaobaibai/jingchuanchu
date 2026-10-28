import {
  defineTheme,
  extendTheme,
  defineComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const base = defineTheme({
  name: 'base',
  tokens: { accent: '#000', spacing: 8 },
  assets: {
    coin: { kind: 'atlas-region', src: '/sheet.png', frame: { x: 0, y: 0, width: 16, height: 16 } },
  },
});
const next = extendTheme(base, {
  name: 'next',
  tokens: { accent: '#fff', spacing: 16 },
  assets: { coin: { kind: 'image', src: '/coin.png' } },
});
const color: string = next.tokens.accent;
const spacing: number = next.tokens.spacing;
// @ts-expect-error token keys remain narrowed
next.tokens.unknown;
// @ts-expect-error definitions are readonly
next.tokens.spacing = 2;
extendTheme(base, {
  name: 'unknown',
  tokens: {
    // @ts-expect-error overriding an unknown token is rejected
    other: 'red',
  },
});
extendTheme(base, {
  name: 'category',
  tokens: {
    // @ts-expect-error numeric token category is preserved
    spacing: 'large',
  },
});
extendTheme(base, {
  name: 'asset',
  assets: {
    // @ts-expect-error overriding unknown assets is rejected
    other: { kind: 'image', src: '/other.png' },
  },
});
extendTheme(base, {
  name: 'bad-frame',
  assets: {
    // @ts-expect-error atlas-region requires a complete frame
    coin: { kind: 'atlas-region', src: '/sheet.png' },
  },
});
void color;
void spacing;
const themed = defineComponent({
  selector: 'typed-theme-component',
  $template: '',
  setup(c) {
    const theme = c.useTheme(base);
    const accent: string = theme.tokens.accent;
    theme.resolve('coin');
    const load = async () => {
      const image = await theme.load('coin');
      if (image.kind === 'atlas-region') {
        const width: number = image.frame.width;
        void width;
      }
      // @ts-expect-error theme loading preserves the supplied contract keys
      theme.load('missing');
      image.release();
    };
    // @ts-expect-error context resolves only the supplied contract keys
    theme.resolve('missing');
    // @ts-expect-error selected tokens remain readonly
    theme.tokens.spacing = 2;
    return { accent, load };
  },
});
void themed;
