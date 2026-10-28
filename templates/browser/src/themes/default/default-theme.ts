import { defineTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';

/** Semantic keys are the contract shared by DOM controls and the game scene. */
export const DefaultTheme = defineTheme({
  name: 'forest-light',
  tokens: {
    background: '#172031',
    surface: '#23324b',
    text: '#e9edf5',
    accent: '#70d4b0',
    'accent-ink': '#10281f',
    player: '#70d4b0',
  },
  assets: {
    'ui.pause': { kind: 'image', src: new URL('./assets/pause.svg', import.meta.url).href },
    'ui.settings': { kind: 'image', src: new URL('./assets/settings.svg', import.meta.url).href },
    'game.collectible': {
      kind: 'atlas-region',
      src: new URL('./assets/collectibles.svg', import.meta.url).href,
      frame: { x: 0, y: 0, width: 24, height: 24 },
    },
  },
});
