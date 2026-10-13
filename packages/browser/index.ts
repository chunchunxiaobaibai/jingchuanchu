import type { Cleanup, Engine, EngineModule, Scope } from '@xiaobai/core';

/** Injectable host boundary allows the clock to be tested without a DOM. */
export interface BrowserDriver {
  requestFrame(callback: (milliseconds: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  subscribeVisibility(callback: () => void): Cleanup;
}
function defaultDriver(): BrowserDriver {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => document.hidden,
    subscribeVisibility(callback) {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}
export function runBrowser(
  engine: Engine,
  onError: (error: unknown) => void,
  options: { driver?: BrowserDriver; scope?: Scope; autoStart?: boolean } = {},
): Cleanup {
  const driver = options.driver ?? defaultDriver();
  const scope = options.scope ?? engine.scope;
  let frame: number | undefined;
  let previous: number | undefined;
  let closed = false;
  let pausedForVisibility = false;
  const suspend = (): void => {
    if (frame !== undefined) driver.cancelFrame(frame);
    frame = undefined;
    previous = undefined;
  };
  const handleError = (error: unknown): void => {
    suspend();
    if (engine.status !== 'disposed') engine.stop();
    onError(error);
  };
  const update = (time: number): void => {
    frame = undefined;
    if (closed || engine.status !== 'running') return;
    try {
      engine.advance(previous === undefined ? 0 : Math.max(0, (time - previous) / 1000));
      previous = time;
    } catch (error) {
      handleError(error);
      return;
    }
    if (!closed && engine.status === 'running' && frame === undefined)
      frame = driver.requestFrame(update);
  };
  const begin = (): void => {
    if (closed || engine.status !== 'running') return;
    if (driver.isHidden()) {
      pausedForVisibility = true;
      engine.pause();
      return;
    }
    if (frame === undefined) frame = driver.requestFrame(update);
  };
  const visibility = (): void => {
    if (driver.isHidden()) {
      if (engine.status === 'running') {
        pausedForVisibility = true;
        engine.pause();
      }
    } else if (pausedForVisibility) {
      pausedForVisibility = false;
      if (engine.status === 'paused') engine.resume();
    }
  };
  const offVisibility = driver.subscribeVisibility(visibility);
  const stop = (): void => {
    closed = true;
    suspend();
    offVisibility();
  };
  engine.events.on('started', begin, scope);
  engine.events.on('resumed', begin, scope);
  engine.events.on('paused', suspend, scope);
  engine.events.on(
    'stopped',
    () => {
      pausedForVisibility = false;
      suspend();
    },
    scope,
  );
  scope.own(stop);
  if (options.autoStart !== false && engine.status === 'stopped') engine.start();
  else begin();
  return stop;
}
export function browserModule(
  options: { driver?: BrowserDriver; onError?: (error: unknown) => void } = {},
): EngineModule {
  return {
    id: 'browser-runtime',
    setup(engine, scope) {
      runBrowser(engine, options.onError ?? ((error) => console.error(error)), {
        ...options,
        scope,
        autoStart: false,
      });
    },
  };
}
