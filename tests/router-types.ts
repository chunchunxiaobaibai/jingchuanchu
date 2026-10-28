import {
  defineRoutes,
  definePage,
  createRouteMatcher,
  type RouteTarget,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Page = definePage({ selector: 'typed-route' });
const routes = defineRoutes([
  { name: 'home', path: '/', page: Page },
  {
    path: '/chapter/:chapterId',
    page: Page,
    children: [{ name: 'level', path: 'level/:levelId', page: Page }],
  },
  { name: 'missing', path: '/*rest', page: Page },
]);
const home: RouteTarget<typeof routes> = { name: 'home' };
const level: RouteTarget<typeof routes> = {
  name: 'level',
  params: { chapterId: 'one', levelId: 2 },
};
// @ts-expect-error unknown route names are rejected
const unknown: RouteTarget<typeof routes> = { name: 'other' };
// @ts-expect-error inherited parameters are required
const missing: RouteTarget<typeof routes> = { name: 'level', params: { levelId: 'one' } };
// @ts-expect-error no-parameter routes reject extra params
const extra: RouteTarget<typeof routes> = { name: 'home', params: { id: 'one' } };
// @ts-expect-error catchAll is an explicit named parameter
const catchAll: RouteTarget<typeof routes> = { name: 'missing' };
createRouteMatcher(routes).resolve(level);
// @ts-expect-error page and loadPage are mutually exclusive
defineRoutes([{ path: '/', page: Page, loadPage: async () => Page }]);
void home;
void level;
void unknown;
void missing;
void extra;
void catchAll;

async function navigate(
  history: import('@xiaobaibaifqy/jingchuanchu-app/application').HistoryDriver,
  renderer: import('@xiaobaibaifqy/jingchuanchu-app/application').RouteRenderer,
) {
  const { createRouter } = await import('@xiaobaibaifqy/jingchuanchu-app/application');
  const router = createRouter({ routes, history, renderer });
  await router.push({ name: 'level', params: { chapterId: 'a', levelId: 1 } });
  const preload = await router.preload({ name: 'level', params: { chapterId: 'a', levelId: 1 } });
  if (preload.status === 'loaded') {
    const path: string = preload.to.fullPath;
    void path;
  }
  // @ts-expect-error preload also preserves inherited route parameter requirements
  router.preload({ name: 'level', params: { levelId: 1 } });
  // @ts-expect-error const router names stay typed
  router.push({ name: 'unknown' });
  // @ts-expect-error inherited params are required
  router.replace({ name: 'level', params: { levelId: 1 } });
  // @ts-expect-error public route state is readonly
  router.current.set(null);
  router.dispose();
}
void navigate;
