import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  defineComponent,
  defineApplication,
  RouterOutlet,
  createMemoryHistoryDriver,
  mountApplication,
  nextTick,
  provideService,
  SaveService,
  type HistoryEntry,
  type AudioDriver,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { jingchuanchu } from '../packages/tooling/vite.mjs';
const settle = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await nextTick();
};

test('actual reference play page owns a single Canvas loop and connects pause, virtual input, restart and route cleanup', async () => {
  await mkdir(resolve('dist/audit'), { recursive: true });
  const directory = await mkdtemp(resolve('dist/audit/reference-play-'));
  try {
    const sourcePath = (file: string) =>
      JSON.stringify(relative(directory, resolve(file)).replaceAll('\\', '/'));
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export {AppRoutes} from ${sourcePath('templates/browser/src/app/app-routes.ts')};export {GameStore} from ${sourcePath('templates/browser/src/game/session/game-store.ts')};export {GameStorage} from ${sourcePath('templates/browser/src/game/preferences/settings-storage.ts')};export {DefaultTheme} from ${sourcePath('templates/browser/src/themes/default/default-theme.ts')};export {DuskTheme} from ${sourcePath('templates/browser/src/themes/dusk/dusk-theme.ts')};export {GameSounds} from ${sourcePath('templates/browser/src/assets/audio/game-sounds.ts')};`,
    );
    const output = join(directory, 'output');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [jingchuanchu()],
      build: {
        outDir: output,
        lib: { entry, formats: ['es'], fileName: () => 'play.mjs' },
        rollupOptions: {
          external: [
            '@xiaobaibaifqy/jingchuanchu-app/application',
            '@xiaobaibaifqy/jingchuanchu-ecs',
            '@xiaobaibaifqy/jingchuanchu-renderer-2d',
            '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision',
            '@xiaobaibaifqy/jingchuanchu-renderer-2d/features',
          ],
        },
      },
    });
    const module = (await import(
      pathToFileURL(join(output, 'play.mjs')).href
    )) as typeof import('../templates/browser/src/app/app-routes.js') &
      typeof import('../templates/browser/src/game/session/game-store.js') &
      typeof import('../templates/browser/src/game/preferences/settings-storage.js') &
      typeof import('../templates/browser/src/themes/default/default-theme.js') &
      typeof import('../templates/browser/src/themes/dusk/dusk-theme.js') &
      typeof import('../templates/browser/src/assets/audio/game-sounds.js');
    const window = new Window(),
      document = window.document as unknown as Document;
    const frames = new Map<number, (time: number) => void>();
    let nextId = 0,
      now = 0,
      draws = 0,
      playerX = Number.NaN;
    document.defaultView!.requestAnimationFrame = (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    };
    document.defaultView!.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    Object.defineProperties(window.HTMLElement.prototype, {
      clientWidth: { configurable: true, get: () => 960 },
      clientHeight: { configurable: true, get: () => 540 },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 960, height: 540 }),
    });
    const spriteCalls: unknown[][] = [];
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        drawImage(...args: unknown[]) {
          spriteCalls.push(args);
        },
        setTransform() {},
        fillRect() {
          draws++;
        },
        beginPath() {},
        arc(x: number, _y: number, radius: number) {
          if (radius === 16) playerX = x;
        },
        fill() {},
        save() {},
        restore() {},
        transform() {},
        scale() {},
      }),
    });
    const startedSounds: number[] = [],
      stoppedSounds: number[] = [];
    let audioUnlocks = 0,
      soundLoads = 0,
      soundStarts = 0,
      soundStops = 0;
    let unlockResult: 'locked' | 'ready' = 'locked',
      failSound = false;
    const driver = (): AudioDriver => ({
      unlock() {
        audioUnlocks++;
        return Promise.resolve(unlockResult);
      },
      async decode(data) {
        return { kind: new Uint8Array(data)[0]! };
      },
      start(decoded) {
        if (failSound) throw new Error('injected sound start failure');
        soundStarts++;
        const kind = (decoded as { kind: number }).kind;
        startedSounds.push(kind);
        return {
          setGain() {},
          pause() {},
          resume() {},
          stop() {
            soundStops++;
            stoppedSounds.push(kind);
          },
        };
      },
      release() {},
      close() {},
    });
    const Root = defineComponent({
      selector: 'play-test-root',
      components: [RouterOutlet],
      $template: '<router-outlet></router-outlet>',
      setup(context) {
        return { game: context.useStore(module.GameStore) };
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const memory = createMemoryHistoryDriver('/');
    let restoring = false,
      releaseRestore!: () => void;
    const waitForRestore = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const history = {
      ...memory,
      async restore(entry: HistoryEntry) {
        restoring = true;
        await waitForRestore;
        await memory.restore(entry);
      },
    };
    const app = await mountApplication(
      host,
      defineApplication({
        root: Root,
        audio: { driver },
        theme: module.DefaultTheme,
        assets: {
          transport: () => ({
            async load(entry) {
              if (entry.kind === 'audio') {
                soundLoads++;
                return new Uint8Array([
                  entry.url === module.GameSounds.entries.complete.url
                    ? 2
                    : entry.url === module.GameSounds.entries.timeout.url
                      ? 3
                      : 1,
                ]).buffer;
              }
              return { source: {} as CanvasImageSource, width: 48, height: 24 };
            },
          }),
        },
        providers: [
          provideService(
            module.GameStorage,
            () =>
              new SaveService({
                storage: {
                  async get() {
                    return null;
                  },
                  async set() {},
                  async remove() {},
                },
              }),
          ),
        ],
        routes: module.AppRoutes,
        router: { history: () => history },
      }),
    );
    const game = app.root.exposed.game;
    const frame = async () => {
      now += 100;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
      await settle();
    };
    memory.push('/levels');
    const navigation = app.router.push({ name: 'play', params: { levelId: 'meadow' } });
    await settle();
    await settle();
    assert.equal(restoring, true);
    assert.equal(frames.size, 0);
    assert.equal(game.state.phase(), 'idle');
    releaseRestore();
    assert.equal((await navigation).status, 'committed');
    await settle();
    assert.ok(host.querySelector('canvas'));
    assert.equal(frames.size, 1);
    await frame();
    await frame();
    assert.equal(game.state.phase(), 'playing');
    assert.ok(draws > 0);
    assert.ok(spriteCalls.length > 0);
    assert.equal(spriteCalls[0]!.length, 9);
    assert.deepEqual(spriteCalls[0]!.slice(1), [0, 0, 24, 24, -0, -0, 20, 20]);
    assert.equal(
      host.querySelector('game-hud img')!.getAttribute('src'),
      module.DefaultTheme.assets['ui.pause'].src,
    );
    const enableAudio = host.querySelector<HTMLButtonElement>('.enable-audio')!;
    enableAudio.click();
    assert.equal(audioUnlocks, 1);
    await settle();
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /尚未解锁/);
    assert.equal(soundLoads, 0);
    unlockResult = 'ready';
    enableAudio.click();
    await settle();
    assert.equal(audioUnlocks, 2);
    assert.equal(soundStarts, 1);
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /已启动/);
    app.audio!.setMuted(true);
    enableAudio.click();
    await settle();
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /当前静音/);
    failSound = true;
    enableAudio.click();
    await settle();
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /播放失败/);
    failSound = false;
    const pause = host.querySelector<HTMLButtonElement>('game-hud button')!;
    pause.click();
    await settle();
    assert.ok(host.querySelector('[role="dialog"]'));
    assert.equal(
      host.querySelector('a[href="/settings"] img')!.getAttribute('src'),
      module.DefaultTheme.assets['ui.settings'].src,
    );
    assert.equal(frames.size, 0);
    const time = game.state.remainingSeconds();
    await frame();
    assert.equal(game.state.remainingSeconds(), time);
    host.querySelector<HTMLButtonElement>('.resume')!.click();
    await settle();
    assert.equal(frames.size, 1);
    await frame();
    await frame();
    assert.ok(game.state.remainingSeconds() < time);
    const keyboard = new window.KeyboardEvent('keydown', {
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    host.querySelector('main')!.dispatchEvent(keyboard as unknown as Event);
    await settle();
    assert.equal(keyboard.defaultPrevented, true);
    assert.equal(frames.size, 0);
    host
      .querySelector('main')!
      .dispatchEvent(
        new window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }) as unknown as Event,
      );
    await settle();
    await frame();
    const beforeMove = playerX;
    const right = [...host.querySelectorAll<HTMLButtonElement>('.direction-pad button')].find(
      (button) => button.textContent?.trim() === '向右',
    )!;
    right.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        button: 0,
        pointerId: 7,
        bubbles: true,
      }) as unknown as Event,
    );
    await frame();
    right.dispatchEvent(
      new window.PointerEvent('pointerup', {
        button: 0,
        pointerId: 7,
        bubbles: true,
      }) as unknown as Event,
    );
    assert.ok(playerX > beforeMove);
    const beforeCollectSound = soundStarts;
    const targetCanvas = host.querySelector('canvas')!;
    targetCanvas.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        pointerId: 18,
        isPrimary: true,
        button: 0,
        clientX: 185,
        clientY: 95,
        bubbles: true,
      }) as unknown as Event,
    );
    await frame();
    targetCanvas.dispatchEvent(
      new window.PointerEvent('pointerup', {
        pointerId: 18,
        isPrimary: true,
        button: 0,
        clientX: 185,
        clientY: 95,
        bubbles: true,
      }) as unknown as Event,
    );
    for (let step = 0; step < 25 && game.state.score() === 0; step++) await frame();
    assert.equal(game.state.score(), 1);
    assert.ok(soundStarts > beforeCollectSound);
    assert.equal(startedSounds.at(-1), 1);
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /收集音效/);
    failSound = true;
    targetCanvas.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        pointerId: 19,
        isPrimary: true,
        button: 0,
        clientX: 365,
        clientY: 95,
        bubbles: true,
      }) as unknown as Event,
    );
    await frame();
    targetCanvas.dispatchEvent(
      new window.PointerEvent('pointerup', {
        pointerId: 19,
        isPrimary: true,
        button: 0,
        clientX: 365,
        clientY: 95,
        bubbles: true,
      }) as unknown as Event,
    );
    for (let step = 0; step < 25 && game.state.score() < 2; step++) await frame();
    assert.equal(game.state.score(), 2);
    assert.equal(game.state.phase(), 'playing');
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /播放失败/);
    assert.equal(frames.size, 1);
    failSound = false;
    const stopsBeforePause = soundStops;
    const run = game.state.runId();
    host.querySelector<HTMLButtonElement>('game-hud button')!.click();
    await settle();
    assert.ok(soundStops > stopsBeforePause);
    host.querySelector<HTMLButtonElement>('.restart')!.click();
    await settle();
    await settle();
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(frames.size, 1);
    await frame();
    await frame();
    assert.ok(game.state.runId() > run);
    assert.ok(game.state.remainingSeconds() > 29);
    assert.equal(game.state.score(), 0);
    assert.equal(frames.size, 1);
    for (let step = 0; step < 370 && game.state.phase() !== 'finished'; step++) await frame();
    assert.equal(game.state.outcome(), 'timeout');
    assert.equal(startedSounds.at(-1), 3);
    assert.match(host.querySelector('.play-audio-status')!.textContent!, /超时音效/);
    const stoppedTimeouts = stoppedSounds.filter((kind) => kind === 3).length;
    assert.ok(host.querySelector('.completed'));
    assert.equal(frames.size, 0);
    const finishedRun = game.state.runId();
    host.querySelector<HTMLButtonElement>('.again')!.click();
    await settle();
    await settle();
    assert.equal(host.querySelector('.completed'), null);
    assert.equal(stoppedSounds.filter((kind) => kind === 3).length, stoppedTimeouts + 1);
    await frame();
    await frame();
    assert.ok(game.state.runId() > finishedRun);
    assert.equal(game.state.phase(), 'playing');
    assert.equal(frames.size, 1);
    const beforeResult = host.querySelector('canvas')!;
    const resultRun = game.state.runId();
    game.actions.finishRun(resultRun, 'timeout');
    await settle();
    assert.ok(host.querySelector('.completed a[href="/result"]'));
    await app.router.push({ name: 'result' });
    await settle();
    assert.equal(host.querySelector('canvas'), null);
    assert.equal(beforeResult.width, 0);
    assert.equal(frames.size, 0);
    assert.match(host.querySelector('.run-result')!.textContent!, /时间到了/);
    assert.ok(soundStops >= 2);
    const replay = host.querySelector('.run-result a')!.getAttribute('href')!;
    await app.router.push(replay);
    await settle();
    await frame();
    await frame();
    assert.equal(game.state.phase(), 'playing');
    assert.ok(game.state.runId() > resultRun);
    assert.equal(game.state.score(), 0);
    assert.equal(frames.size, 1);
    const canvas = host.querySelector('canvas')!;
    await app.router.push({ name: 'level-select' });
    await settle();
    assert.equal(frames.size, 0);
    assert.equal(host.querySelector('canvas'), null);
    assert.equal(canvas.width, 0);
    assert.equal(game.state.phase(), 'idle');
    app.dispose();
    assert.equal(frames.size, 0);
    // The same actual page uses whole-image sprites under the alternative theme.
    const duskHost = document.createElement('div');
    document.body.append(duskHost);
    let failImage = true,
      releaseImage: ((value: unknown) => void) | undefined;
    const dusk = await mountApplication(
      duskHost,
      defineApplication({
        root: Root,
        audio: { driver },
        routes: module.AppRoutes,
        theme: module.DuskTheme,
        assets: {
          transport: () => ({
            async load() {
              if (failImage) throw new Error('injected image failure');
              return new Promise((resolve) => {
                releaseImage = resolve;
              });
            },
          }),
        },
        router: { history: () => createMemoryHistoryDriver('/play/meadow') },
      }),
    );
    await settle();
    assert.ok(duskHost.querySelector('.retry-assets'));
    assert.equal(duskHost.querySelector('canvas'), null);
    assert.equal(dusk.root.exposed.game.state.phase(), 'idle');
    failImage = false;
    duskHost.querySelector<HTMLButtonElement>('.retry-assets')!.click();
    await settle();
    assert.ok(duskHost.querySelector('.asset-loading'));
    assert.equal(frames.size, 0);
    releaseImage!({ source: {} as CanvasImageSource, width: 24, height: 24 });
    await settle();
    await settle();
    const priorDraws = spriteCalls.length;
    await frame();
    await frame();
    assert.ok(spriteCalls.length > priorDraws);
    assert.equal(spriteCalls[priorDraws]!.length, 5);
    assert.deepEqual(spriteCalls[priorDraws]!.slice(1), [-0, -0, 20, 20]);
    assert.equal(
      duskHost.querySelector('game-hud img')!.getAttribute('src'),
      module.DuskTheme.assets['ui.pause'].src,
    );
    assert.equal(dusk.root.exposed.game.state.phase(), 'playing');
    assert.equal(frames.size, 1);
    dusk.dispose();
    assert.equal(frames.size, 0);
    // Leaving a page while its image is pending must not create a late Canvas or retain raw data.
    const lateHost = document.createElement('div');
    let resolveLate: ((value: unknown) => void) | undefined,
      releasedLate = 0;
    const late = await mountApplication(
      lateHost,
      defineApplication({
        root: Root,
        audio: { driver },
        routes: module.AppRoutes,
        theme: module.DefaultTheme,
        assets: {
          transport: () => ({
            async load() {
              return new Promise((resolve) => {
                resolveLate = resolve;
              });
            },
            release() {
              releasedLate++;
            },
          }),
        },
        router: { history: () => createMemoryHistoryDriver('/play/meadow') },
      }),
    );
    await settle();
    assert.ok(lateHost.querySelector('.asset-loading'));
    await late.router.push({ name: 'home' });
    resolveLate!({ source: {} as CanvasImageSource, width: 48, height: 24 });
    await settle();
    await settle();
    assert.equal(lateHost.querySelector('canvas'), null);
    assert.equal(late.root.exposed.game.state.phase(), 'idle');
    assert.equal(frames.size, 0);
    assert.equal(releasedLate, 1);
    late.dispose();
    await window.happyDOM.abort();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
