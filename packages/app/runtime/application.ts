import {
  COMPONENT,
  type ComponentDefinition,
  type PageDefinition,
  type InputMap,
  type OutputMap,
  type ModelMap,
  type InputValues,
} from './component-types.js';
import { mountComponent, type ComponentInstance } from './component-runtime.js';
import { ComponentOwner } from './component-owner.js';
import { ServiceRegistry, type ServiceProvider, type ServiceContext } from './services.js';
import { StoreRegistry } from './store.js';
import { signal, SIGNAL, type ReadSignal } from './reactivity.js';
import { snapshot, type ReadonlyData } from '../state.js';
import { reportApplicationError } from './errors.js';
import { OwnerAudioContexts } from './audio-context.js';
import { AUDIO_CONTEXT } from './context-keys.js';
import { AudioError } from './audio-driver.js';
import {
  createApplicationAudio,
  validateAudioOptions,
  type ApplicationAudioOptions,
  type AudioControls,
} from './application-audio.js';
import { AssetService } from './asset-service.js';
import { ASSETS_CONTEXT, THEME_CONTEXT } from './context-keys.js';
import type { AssetContext, ApplicationAssetOptions } from './asset-types.js';
import { ThemeService, mountThemeTokens } from './theme-service.js';
import {
  THEME,
  ThemeError,
  type ThemeTokens,
  type ThemeAssets,
  type ThemeDefinition,
  type ThemeContext,
} from './theme-types.js';
import { defineRoutes } from './router/matcher.js';
import { createRouter, type Router } from './router/router.js';
import { createBrowserHistoryDriver, type BrowserHistoryHost } from './router/browser-history.js';
import { createDOMRouteRenderer } from './router/dom-renderer.js';
import { resolveRouteOutlet } from './router/outlets.js';
import { installRouterContext } from './router/context.js';
import { defaultIdleScheduler, scheduleIdlePreloads, type IdleScheduler } from './router/idle.js';
import {
  RouteError,
  type RouteDefinition,
  type HistoryDriver,
  type RouteRenderer,
  type RouteTarget,
  type RouteLocation,
  type RouteGuard,
} from './router/types.js';

export interface ApplicationRouterContext<
  R extends readonly RouteDefinition[],
> extends ServiceContext {
  resolve(target: RouteTarget<R>): RouteLocation;
}
export type ApplicationRouterOptions<
  R extends readonly RouteDefinition[] = readonly RouteDefinition[],
> = (
  | { readonly history: () => HistoryDriver; readonly mode?: never; readonly base?: never }
  | { readonly history?: never; readonly mode?: 'hash' | 'history'; readonly base?: string }
) & {
  readonly guards?: (context: ApplicationRouterContext<R>) => readonly RouteGuard[];
  readonly idle?: {
    readonly targets: readonly RouteTarget<R>[];
    readonly scheduler?: IdleScheduler;
  };
};
type ApplicationRouter<R> = R extends readonly RouteDefinition[] ? Router<R> : undefined;
const APPLICATION = Symbol('application definition');
const hosts = new WeakSet<Element>();
export type ApplicationStatus = 'running' | 'disposed';
export class ApplicationError extends Error {
  constructor(
    readonly module: string,
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Application ${source}: ${operation} failed${cause instanceof Error ? `: ${cause.message}` : ''}`,
      { cause },
    );
    this.name = 'ApplicationError';
  }
}
export interface ApplicationDebugOptions {
  /** 显示调试性能面板（悬浮窗）。true 使用默认配置，或传入位置和透明度选项。 */
  perfPanel?: boolean | import('./perf-panel.js').PerfPanelOptions;
}
export interface ApplicationOptions<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
  R extends readonly RouteDefinition[] | undefined = undefined,
> {
  readonly root: ComponentDefinition<I, O, M, X> | PageDefinition<I, O, M, X>;
  readonly providers?: readonly ServiceProvider<unknown>[];
  readonly assets?: ApplicationAssetOptions;
  readonly audio?: ApplicationAudioOptions;
  readonly theme?: ThemeDefinition<ThemeTokens, ThemeAssets>;
  readonly routes?: R;
  readonly router?: ApplicationRouterOptions<Extract<R, readonly RouteDefinition[]>>;
  readonly inputs?: Partial<InputValues<I, M>>;
  readonly debug?: ApplicationDebugOptions;
  readonly onError?: (error: ApplicationError) => void;
}
export interface ApplicationDefinition<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
  R extends readonly RouteDefinition[] | undefined = undefined,
> extends Omit<ApplicationOptions<I, O, M, X, R>, 'inputs'> {
  readonly [APPLICATION]: true;
  readonly inputs?: ReadonlyData<Partial<InputValues<I, M>>>;
}
export interface ApplicationInstance<
  P,
  X extends object,
  R extends readonly RouteDefinition[] | undefined = undefined,
> {
  readonly router: ApplicationRouter<R>;
  readonly assets: AssetContext | undefined;
  readonly audio: AudioControls | undefined;
  useTheme<T extends ThemeTokens, A extends ThemeAssets>(
    contract: ThemeDefinition<T, A>,
  ): ThemeContext<T, A>;
  readonly root: ComponentInstance<P, X>;
  readonly state: ReadSignal<ApplicationStatus>;
  dispose(): void;
}
function failure(source: string, operation: string, error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const metadata = error as { module?: unknown; source?: unknown; operation?: unknown } | null;
  return new ApplicationError(
    typeof metadata?.module === 'string' ? metadata.module : 'application-services',
    typeof metadata?.source === 'string' ? metadata.source : source,
    typeof metadata?.operation === 'string' ? metadata.operation : operation,
    error,
  );
}
export function defineApplication<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
  const R extends readonly RouteDefinition[] | undefined = undefined,
>(options: ApplicationOptions<I, O, M, X, R>): ApplicationDefinition<I, O, M, X, R> {
  const source = options.root?.selector ?? 'application';
  try {
    if (options.root?.[COMPONENT] !== true)
      throw new Error('root must be a component or page definition');
    if (options.theme !== undefined && options.theme[THEME] !== true)
      throw new Error('theme requires defineTheme/extendTheme');
    if (options.router && options.routes === undefined) throw new Error('router requires routes');
    if (options.router?.history !== undefined) {
      if (typeof options.router.history !== 'function')
        throw new Error('router.history must be a factory');
      if (Object.hasOwn(options.router, 'mode') || Object.hasOwn(options.router, 'base'))
        throw new Error('router.history cannot be combined with mode/base');
    }
    if (options.router?.guards !== undefined && typeof options.router.guards !== 'function')
      throw new Error('router.guards must be a synchronous factory');
    const routes = options.routes === undefined ? undefined : defineRoutes(options.routes);
    if (options.assets && typeof options.assets.transport !== 'function')
      throw new Error('assets.transport must be a factory');
    if (
      options.assets?.concurrency !== undefined &&
      (!Number.isSafeInteger(options.assets.concurrency) || options.assets.concurrency < 1)
    )
      throw new Error('Asset concurrency must be a positive integer');
    if (options.audio) {
      validateAudioOptions(options.audio);
      if (!options.assets)
        throw new AudioError(
          '<settings>',
          'assets',
          'define',
          new Error('audio requires application assets'),
        );
    }
    const idle = options.router?.idle;
    if (idle && !Array.isArray(idle.targets))
      throw new Error('router.idle.targets must be an array');
    if (idle?.scheduler && typeof idle.scheduler.schedule !== 'function')
      throw new Error('idle scheduler must provide schedule');
    const router = options.router
      ? Object.freeze({
          ...options.router,
          ...(idle
            ? {
                idle: Object.freeze({
                  ...idle,
                  targets: Object.freeze(
                    idle.targets.map(
                      (target) =>
                        snapshot(target) as RouteTarget<Extract<R, readonly RouteDefinition[]>>,
                    ),
                  ),
                }),
              }
            : {}),
        })
      : undefined;
    const providers = Object.freeze([...(options.providers ?? [])]);
    // Reject invalid/duplicate registrations before any owner or view is created.
    new ServiceRegistry(providers);
    const { inputs, ...configuration } = options;
    return Object.freeze({
      ...configuration,
      [APPLICATION]: true as const,
      providers,
      ...(options.assets ? { assets: Object.freeze({ ...options.assets }) } : {}),
      ...(options.audio ? { audio: Object.freeze({ ...options.audio }) } : {}),
      ...(routes !== undefined ? { routes: routes as R } : {}),
      ...(router ? { router } : {}),
      ...(inputs ? { inputs: snapshot(inputs) } : {}),
    });
  } catch (error) {
    throw failure(source, 'define', error);
  }
}
export async function mountApplication<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
  R extends readonly RouteDefinition[] | undefined = undefined,
>(
  host: Element,
  definition: ApplicationDefinition<I, O, M, X, R>,
): Promise<ApplicationInstance<InputValues<I, M>, X, R>> {
  const source = definition.root?.$source ?? definition.root?.selector ?? 'application';
  let owner: ComponentOwner | undefined,
    locked = false;
  let router: Router<readonly RouteDefinition[]> | undefined;
  let starting = true,
    closing = false;
  const shutdown = (): void => {
    closing = true;
    const errors: unknown[] = [];
    for (const cleanup of [() => router?.dispose(), () => owner?.dispose()]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed');
  };
  const notify = (error: ApplicationError, asynchronous = false): void => {
    if (definition.onError) reportApplicationError(error, () => definition.onError!(error));
    else if (asynchronous) reportApplicationError(error);
  };
  const observe = (error: unknown) => notify(failure(source, 'runtime', error), true);
  try {
    if (definition[APPLICATION] !== true) throw new Error('Expected defineApplication(...)');
    if (hosts.has(host)) throw new Error('Application host is already mounted');
    hosts.add(host);
    locked = true;
    owner = new ComponentOwner(undefined, {
      services: new ServiceRegistry(definition.providers),
      stores: new StoreRegistry([], { automatic: true }),
    });
    let assets: AssetContext | undefined;
    let audio: AudioControls | undefined;
    let theme: ThemeService | undefined;
    if (definition.theme) {
      theme = new ThemeService(definition.theme, definition.onError ? observe : undefined);
      const current = theme;
      owner.scope.own(() => current.dispose());
      owner.scope.own(mountThemeTokens(host, definition.theme));
      owner.provideContext(THEME_CONTEXT, theme);
    }
    if (definition.assets) {
      const service = new AssetService(definition.assets, observe);
      owner.scope.own(() => service.dispose());
      owner.provideContext(ASSETS_CONTEXT, service);
      assets = service.forOwner(owner);
    }
    if (definition.audio) {
      if (!assets)
        throw new AudioError(
          '<settings>',
          'assets',
          'create',
          new Error('Application assets are not configured'),
        );
      const service = createApplicationAudio(definition.audio, assets, owner.scope, observe);
      const contexts = new OwnerAudioContexts(service);
      owner.provideContext(AUDIO_CONTEXT, contexts);
      audio = contexts.forOwner(owner);
      const audioVisibility = () =>
        contexts.setBackground(host.ownerDocument.visibilityState !== 'hidden');
      audioVisibility();
      host.ownerDocument.addEventListener('visibilitychange', audioVisibility);
      owner.scope.own(() =>
        host.ownerDocument.removeEventListener('visibilitychange', audioVisibility),
      );
      const offAudio = owner.cancellation.subscribe(() => service.dispose());
      owner.scope.own(offAudio);
    }
    let renderer: RouteRenderer | undefined;
    let history: HistoryDriver | undefined;
    if (definition.routes !== undefined) {
      const configuration = definition.router;
      if (!configuration?.history && !host.ownerDocument.defaultView)
        throw new Error('Host document has no window; provide router.history');
      history = configuration?.history
        ? configuration.history()
        : createBrowserHistoryDriver({
            window: host.ownerDocument.defaultView as unknown as BrowserHistoryHost,
            ...(configuration?.mode ? { mode: configuration.mode } : {}),
            ...(configuration?.base !== undefined ? { base: configuration.base } : {}),
          });
      try {
        let guards: readonly RouteGuard[] = [];
        router = createRouter<readonly RouteDefinition[]>({
          routes: definition.routes,
          history,
          ...(configuration?.guards
            ? {
                guards: [
                  async (context) => {
                    for (const guard of guards) {
                      if (context.signal.aborted) return { status: 'deny', reason: 'cancelled' };
                      const result = await guard(context);
                      if (!result || !['allow', 'deny', 'redirect'].includes(result.status))
                        throw new Error('Guard must return allow, deny or redirect');
                      if (result.status !== 'allow') return result;
                    }
                    return { status: 'allow' };
                  },
                ],
              }
            : {}),
          renderer: {
            create(context) {
              if (!renderer) throw new Error('Application route outlet is not ready');
              return renderer.create(context);
            },
          },
          onError(error) {
            if (!starting && !closing) observe(error);
          },
        });
        if (configuration?.guards) {
          const guardOwner = owner;
          const configured = configuration.guards({
            scope: owner.scope,
            signal: owner.cancellation,
            own: (cleanup) => guardOwner.scope.own(cleanup),
            useService: (definition) => guardOwner.resolve('services', definition),
            resolve: (target) => router!.resolve(target),
          });
          if (
            !Array.isArray(configured) ||
            configured.some((guard) => typeof guard !== 'function')
          ) {
            void Promise.resolve(configured).catch(() => {});
            throw new Error('router.guards must return an array of functions synchronously');
          }
          guards = Object.freeze([...configured]);
        }
      } catch (error) {
        try {
          if (router) router.dispose();
          else history.dispose();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError]);
        }
        throw error;
      }
      owner.scope.own(() => router?.dispose());
      installRouterContext(owner, router);
    }
    const root = mountComponent(host, definition.root, {
      owner,
      ...(definition.inputs ? { inputs: definition.inputs as Partial<InputValues<I, M>> } : {}),
      onError: observe,
    });
    if (router && history) {
      renderer = createDOMRouteRenderer(resolveRouteOutlet(root.owner).host, root.owner, {
        onError: observe,
      });
      const result = await router.replace(history.read().fullPath);
      if (result.status !== 'committed' && result.status !== 'redirected')
        throw result.status === 'failed'
          ? result.error
          : new RouteError(
              source,
              'initial navigation',
              new Error(`Initial navigation ${result.status}`),
            );
    }
    starting = false;
    const idle = definition.router?.idle;
    if (router && idle)
      owner.scope.own(
        scheduleIdlePreloads(
          router,
          idle.targets,
          idle.scheduler ?? defaultIdleScheduler(host.ownerDocument.defaultView),
          observe,
        ),
      );
    const status = signal<ApplicationStatus>('running');
    const read = Object.freeze(
      Object.defineProperty(() => status(), SIGNAL, { value: true }),
    ) as ReadSignal<ApplicationStatus>;
    let disposed = false;
    return Object.freeze({
      root,
      router: router as ApplicationRouter<R>,
      assets,
      audio,
      useTheme<T extends ThemeTokens, A extends ThemeAssets>(
        contract: ThemeDefinition<T, A>,
      ): ThemeContext<T, A> {
        if (!theme)
          throw new ThemeError(
            contract.name,
            '<theme>',
            'resolve',
            new Error('Application theme is not configured'),
          );
        return theme.forOwner(owner!, contract);
      },
      state: read,
      dispose() {
        if (disposed) return;
        disposed = true;
        status.set('disposed');
        let error: ApplicationError | undefined;
        try {
          shutdown();
        } catch (cause) {
          error = failure(source, 'dispose', cause);
        } finally {
          hosts.delete(host);
        }
        if (error) {
          notify(error);
          throw error;
        }
      },
    });
  } catch (error) {
    let cause = error;
    try {
      shutdown();
    } catch (cleanupError) {
      cause = new AggregateError([error, cleanupError], 'Application startup and cleanup failed');
    }
    if (locked) hosts.delete(host);
    const result = failure(source, 'mount', cause);
    notify(result);
    throw result;
  }
}
export async function bootstrapApplication<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  X extends object,
  R extends readonly RouteDefinition[] | undefined = undefined,
>(
  definition: ApplicationDefinition<I, O, M, X, R>,
  options: { document?: Document } = {},
): Promise<ApplicationInstance<InputValues<I, M>, X, R>> {
  const document = options.document ?? globalThis.document;
  if (!document)
    throw failure(
      definition.root.selector,
      'bootstrap',
      new Error('Document is unavailable; pass {document}'),
    );
  const hosts = document.querySelectorAll(definition.root.selector);
  if (hosts.length !== 1)
    throw failure(
      definition.root.selector,
      'bootstrap',
      new Error(`Expected one ${definition.root.selector} host, found ${hosts.length}`),
    );
  return mountApplication(hosts[0]!, definition);
}
