import { findLevel } from '../game/session/levels.js';
import { defineRoutes, type GuardResult } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const AppRoutes = defineRoutes([
  {
    name: 'result',
    path: '/result',
    loadPage: () => import('../pages/result/result-page.js').then((module) => module.ResultPage),
  },
  {
    name: 'settings',
    path: '/settings',
    loadPage: () =>
      import('../pages/settings/settings-page.js').then((module) => module.SettingsPage),
  },
  {
    name: 'play',
    path: '/play/:levelId',
    guards: [
      (context): GuardResult =>
        findLevel(context.params.levelId)
          ? { status: 'allow' }
          : { status: 'redirect', target: { name: 'level-select' } },
    ],
    prepare(context) {
      const level = findLevel(context.params.levelId);
      if (!level) throw new Error('Unknown game level');
      return { levelId: level.id };
    },
    loadPage: () => import('../pages/play/play-page.js').then((module) => module.PlayPage),
  },
  {
    name: 'level-select',
    path: '/levels',
    loadPage: () =>
      import('../pages/level-select/level-select-page.js').then((module) => module.LevelSelectPage),
    preload: 'intent',
  },
  {
    name: 'level-preview',
    path: '/levels/:levelId',
    guards: [
      (context): GuardResult =>
        findLevel(context.params.levelId)
          ? { status: 'allow' }
          : { status: 'redirect', target: { name: 'level-select' } },
    ],
    loadPage: () =>
      import('../pages/level-select/level-select-page.js').then((module) => module.LevelSelectPage),
  },
  {
    name: 'home',
    path: '/',
    loadPage: () => import('../pages/home/home-page.js').then((module) => module.HomePage),
  },
]);
