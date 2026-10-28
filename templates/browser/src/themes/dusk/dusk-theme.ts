import { extendTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { DefaultTheme } from '../default/default-theme.js';

/** Developer-selected alternative; a whole image replaces the default atlas region. */
export const DuskTheme = extendTheme(DefaultTheme, {
  name: 'dusk-stars',
  tokens: {
    background: '#231d35',
    surface: '#372a4f',
    text: '#f7edff',
    accent: '#d8b4fe',
    'accent-ink': '#2d1645',
    player: '#c4b5fd',
  },
  assets: {
    'ui.pause': { kind: 'image', src: new URL('./assets/pause.svg', import.meta.url).href },
    'ui.settings': { kind: 'image', src: new URL('./assets/settings.svg', import.meta.url).href },
    'game.collectible': { kind: 'image', src: new URL('./assets/star.svg', import.meta.url).href },
  },
});
