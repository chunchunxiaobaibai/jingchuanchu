import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserHistoryDriver,
  createRouter,
  definePage,
  defineRoutes,
  type BrowserHistoryHost,
  type RouteCandidate,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

/** Injected native primitives: no browser process, DOM automation or actual device history. */
function nativeHost(address: string) {
  const entries = [
      { url: new URL(address), state: structuredClone({ hostData: 'keep' }) as unknown },
    ],
    listeners = new Map<string, Set<EventListener>>(),
    jobs: (() => void)[] = [];
  let index = 0,
    paused = false;
  const emit = (type: string) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(new Event(type));
  };
  const history = {
    get state() {
      return entries[index]!.state;
    },
    pushState(data: unknown, _title: string, url?: string | URL | null) {
      const entry = {
        url: new URL(String(url ?? entries[index]!.url), entries[index]!.url),
        state: structuredClone(data),
      };
      entries.splice(index + 1);
      entries.push(entry);
      index++;
    },
    replaceState(data: unknown, _title: string, url?: string | URL | null) {
      entries[index] = {
        url: new URL(String(url ?? entries[index]!.url), entries[index]!.url),
        state: structuredClone(data),
      };
    },
    go(delta: number) {
      const destination = index + delta;
      if (destination < 0 || destination >= entries.length) return;
      const move = () => {
        const oldHash = entries[index]!.url.hash;
        index = destination;
        emit('popstate');
        if (oldHash !== entries[index]!.url.hash) emit('hashchange');
      };
      if (paused) jobs.push(move);
      else queueMicrotask(move);
    },
  };
  const host: BrowserHistoryHost = {
    get location() {
      return entries[index]!.url;
    },
    history,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    host,
    emit,
    pause() {
      paused = true;
    },
    flush() {
      paused = false;
      for (const job of jobs.splice(0)) queueMicrotask(job);
    },
    get queued() {
      return jobs.length;
    },
    get listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('hash driver preserves host state, deduplicates native events and silently restores managed positions', async () => {
  const native = nativeHost('https://example.test/game/index.html?campaign=one'),
    driver = createBrowserHistoryDriver({ window: native.host }),
    changes: string[] = [];
  driver.listen((entry) => changes.push(entry.fullPath));
  assert.equal(driver.createHref!('/one?q=a%20b#panel'), '#/one?q=a+b#panel');
  assert.equal(driver.read().fullPath, '/');
  assert.equal(native.host.location.hash, '#/');
  assert.equal((native.host.history.state as { hostData: string }).hostData, 'keep');
  assert.equal(native.listenerCount, 2);
  const one = driver.push('/one?x=a%20b#panel'),
    two = driver.push('/two');
  assert.deepEqual(changes, []);
  assert.equal(native.host.location.pathname, '/game/index.html');
  assert.equal(native.host.location.search, '?campaign=one');
  await driver.go(-1);
  assert.equal(driver.read().fullPath, '/one?x=a+b#panel');
  assert.deepEqual(changes, ['/one?x=a+b#panel']);
  await driver.restore(two);
  assert.equal(driver.read().position, 2);
  assert.deepEqual(changes, ['/one?x=a+b#panel']);
  await driver.restore(one);
  driver.push('/branch');
  assert.equal(await driver.go(1), null);
  await assert.rejects(driver.restore(two), /no longer available/);
  assert.equal((native.host.history.state as { hostData: string }).hostData, 'keep');
  driver.dispose();
  assert.equal(native.listenerCount, 0);
});

test('history mode respects its base and resumes managed positions after driver recreation', async () => {
  const native = nativeHost('https://example.test/games/home?one=1#note');
  let driver = createBrowserHistoryDriver({
    window: native.host,
    mode: 'history',
    base: '/games/',
  });
  assert.equal(driver.read().fullPath, '/home?one=1#note');
  assert.equal(driver.createHref!('/level/one?q=yes#hud'), '/games/level/one?q=yes#hud');
  driver.push('/level/one');
  driver.push('/level/two');
  await driver.go(-2);
  assert.equal(native.host.location.pathname, '/games/home');
  driver.dispose();
  driver = createBrowserHistoryDriver({ window: native.host, mode: 'history', base: '/games' });
  assert.equal(driver.read().position, 0);
  await driver.go(2);
  assert.equal(driver.read().fullPath, '/level/two');
  assert.equal(native.host.location.pathname, '/games/level/two');
  driver.dispose();
  assert.equal(native.listenerCount, 0);
  const outside = nativeHost('https://example.test/outside');
  assert.throws(
    () => createBrowserHistoryDriver({ window: outside.host, mode: 'history', base: '/games' }),
    /outside/,
  );
  assert.equal(outside.listenerCount, 0);
});

test('unmanaged native entries fail explicitly and disposing releases listeners, pending traversal and the window lock', async () => {
  const native = nativeHost('https://example.test/game'),
    errors: unknown[] = [],
    driver = createBrowserHistoryDriver({
      window: native.host,
      onError: (error) => {
        errors.push(error);
      },
    });
  assert.throws(() => createBrowserHistoryDriver({ window: native.host }), /already owns/);
  native.host.history.replaceState({ hostData: 'foreign' }, '', '#/unmanaged');
  native.emit('popstate');
  assert.equal(errors.length, 1);
  assert.throws(() => driver.read(), /Unmanaged history/);
  driver.dispose();
  assert.equal(native.listenerCount, 0);
  const replacement = createBrowserHistoryDriver({ window: native.host });
  assert.equal(replacement.read().fullPath, '/unmanaged');
  replacement.push('/next');
  native.pause();
  const pending = replacement.go(-1);
  assert.equal(native.queued, 1);
  replacement.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(native.listenerCount, 0);
  native.flush();
  await settle();
  const rebased = createBrowserHistoryDriver({ window: native.host });
  native.host.history.replaceState({}, '', '#/silent');
  assert.throws(() => rebased.read(), /Unmanaged history/);
  rebased.dispose();
});

test('a queued native back cannot override a later router push', async () => {
  const native = nativeHost('https://example.test/game#/a'),
    history = createBrowserHistoryDriver({ window: native.host }),
    Page = definePage({ selector: 'native-page', $template: '<p>page</p>' });
  let active: object | null = null;
  const router = createRouter({
    routes: defineRoutes([
      { path: '/a', page: Page },
      { path: '/b', page: Page },
      { path: '/c', page: Page },
    ]),
    history,
    renderer: {
      create() {
        const candidate: RouteCandidate = {
          commit() {
            const previous = active;
            active = candidate;
            return () => {
              active = previous;
            };
          },
          dispose() {
            if (active === candidate) active = null;
          },
        };
        return candidate;
      },
    },
  });
  await router.replace('/a');
  await router.push('/b');
  native.pause();
  const back = router.back();
  await settle();
  assert.equal(native.queued, 1);
  const next = router.push('/c');
  native.flush();
  assert.equal((await back).status, 'cancelled');
  assert.equal((await next).status, 'committed');
  assert.equal(router.current()!.path, '/c');
  assert.equal(history.read().position, 2);
  assert.equal(native.host.location.hash, '#/c');
  router.dispose();
  assert.equal(active, null);
  assert.equal(native.listenerCount, 0);
});
