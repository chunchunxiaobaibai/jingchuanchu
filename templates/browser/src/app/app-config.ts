import { defineApplication, provideService } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppShell } from './app-shell.js';
import { AppRoutes } from './app-routes.js';
import { GameStorage } from '../game/preferences/settings-storage.js';
import { DefaultTheme } from '../themes/default/default-theme.js';
import { createBrowserAssetTransport } from './asset-transport.js';
import { createWebAudioDriver } from './web-audio-driver.js';
export const AppConfig = defineApplication({
  root: AppShell,
  theme: DefaultTheme,
  assets: { transport: () => createBrowserAssetTransport() },
  audio: { driver: () => createWebAudioDriver(), maxEffects: 8 },
  routes: AppRoutes,
  providers: [provideService(GameStorage)],
});
