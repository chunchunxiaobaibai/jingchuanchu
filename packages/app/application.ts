export { signal, computed, effect } from './runtime/reactivity.js';
export { batch, nextTick } from './runtime/scheduler.js';
export type { ReadSignal, WritableSignal, EffectOptions } from './runtime/reactivity.js';
export type { ReadonlyData } from './state.js';
export { defineComponent, definePage, input, output, model } from './runtime/component.js';
export type {
  ComponentContext,
  ComponentHookContext,
  ComponentOptions,
  ComponentDefinition,
  PageDefinition,
  ComponentReference,
  InputDefinition,
  OutputDefinition,
  ModelDefinition,
} from './runtime/component-types.js';
export { mountComponent, ComponentError } from './runtime/component-runtime.js';
export type { ComponentInstance, ComponentMountOptions } from './runtime/component-runtime.js';

export { TemplateError } from './runtime/template.js';
export type {
  TemplateScope,
  TemplateField,
  TemplateOutput,
  TemplateClass,
} from './runtime/template.js';

export { writableModel } from './runtime/models.js';
export type {
  WritableModel,
  ConvertedModel,
  WritableModelOptions,
  ModelConversion,
  ModelValidation,
  NativeValueModel,
} from './runtime/models.js';

export { defineStore, StoreError } from './runtime/store.js';
export type { StoreDefinition, StoreInstance, StoreContext } from './runtime/store.js';

export type {
  StoreTaskContext,
  StoreTaskOptions,
  StoreTaskResult,
  StoreCommitResult,
} from './runtime/store-tasks.js';

export { defineService, provideService, ServiceError } from './runtime/services.js';
export type {
  ServiceDefinition,
  ServiceProvider,
  ServiceFactory,
  ServiceContext,
} from './runtime/services.js';

export {
  defineApplication,
  mountApplication,
  bootstrapApplication,
  ApplicationError,
} from './runtime/application.js';
export type {
  ApplicationOptions,
  ApplicationDefinition,
  ApplicationInstance,
  ApplicationStatus,
  ApplicationRouterOptions,
  ApplicationRouterContext,
} from './runtime/application.js';

export { defineRoutes, createRouteMatcher } from './runtime/router/matcher.js';
export { createMemoryHistoryDriver } from './runtime/router/history.js';
export { RouteError } from './runtime/router/types.js';
export type {
  RouteDefinition,
  RoutePage,
  RouteTarget,
  NamedRouteTarget,
  RouteLocation,
  RouteMatch,
  RouteQuery,
  RouteQueryInput,
  RouteMatcher,
  NavigationContext,
  GuardResult,
  RouteGuard,
  HistoryDriver,
  HistoryEntry,
} from './runtime/router/types.js';

export { createRouter } from './runtime/router/router.js';
export type { Router } from './runtime/router/router.js';
export type {
  NavigationResult,
  RoutePreloadResult,
  RoutePreloadOptions,
  NavigationPending,
  RouteDiagnostic,
  PreparedRoutePage,
  RouteRenderContext,
  RouteRenderer,
  RouteCandidate,
} from './runtime/router/types.js';

export { createBrowserHistoryDriver } from './runtime/router/browser-history.js';
export type { BrowserHistoryHost } from './runtime/router/browser-history.js';
export type { IdleScheduler } from './runtime/router/idle.js';
export { RouterOutlet, RouteLink } from './runtime/router/components.js';
export { defineAssetGroup } from './runtime/assets.js';
export { AssetError } from './runtime/asset-types.js';
export type {
  AssetGroup,
  AssetEntries,
  AssetEntry,
  ImageAssetEntry,
  AudioAssetEntry,
  JsonAssetEntry,
  AtlasAssetEntry,
  AtlasFrame,
  AtlasFrames,
  AssetImage,
  AssetAtlas,
  AssetValue,
  AssetGroupLease,
  AssetLoadOptions,
  AssetGroupProgress,
  AssetContext,
  AssetTransport,
  ApplicationAssetOptions,
} from './runtime/asset-types.js';
export { defineTheme, extendTheme } from './runtime/theme.js';
export { ThemeError } from './runtime/theme-types.js';
export type {
  ThemeTokens,
  ThemeAssets,
  ThemeAsset,
  ThemeImage,
  ThemeAtlasRegion,
  ThemeDefinition,
  ThemeOverrides,
  ThemeContext,
  ThemeImageLease,
  ThemeLoadOptions,
} from './runtime/theme-types.js';
export { createViewport, ViewportError } from './runtime/viewport.js';
export type {
  Viewport,
  ViewportDriver,
  ViewportLayout,
  ViewportMeasurement,
  GamePoint,
} from './runtime/viewport.js';
export { defineActions, ActionError } from './runtime/input-actions.js';
export type {
  AxisAction,
  ButtonAction,
  ActionEntry,
  ActionEntries,
  ActionDefinitions,
  ActionSnapshot,
  ButtonSnapshot,
} from './runtime/input-actions.js';
export { createActions } from './runtime/browser-actions.js';
export type { Actions } from './runtime/browser-actions.js';
export { createGameClock, GameClockError } from './runtime/game-clock.js';
export type { GameClock, GameTimer, GameTimerStatus } from './runtime/game-clock.js';

export { TweenError } from './runtime/tweens.js';
export type {
  TweenEasing,
  TweenValue,
  TweenOutput,
  TweenStatus,
  TweenHandle,
  TweenOptions,
} from './runtime/tweens.js';
export { defineGameScene, GameSceneError } from './runtime/game-scene.js';
export type {
  GameSceneDefinition,
  GameSceneOptions,
  GameSceneContext,
  GameSceneAccess,
} from './runtime/game-scene.js';
export { GameCanvas, CanvasHostError } from './runtime/game-canvas.js';
export type {
  GameCanvasOptions,
  GameCanvasStatus,
  GameCanvasHandle,
  GameSceneControls,
  GameCanvasScene,
  CanvasRuntimeRenderer,
} from './runtime/game-canvas.js';
export { AudioError } from './runtime/audio-driver.js';
export type {
  AudioDriver,
  AudioVoice,
  AudioState,
  AudioGroup,
  AudioChannel,
  DecodedAudio,
  AudioPreferences,
  AudioUnlockResult,
} from './runtime/audio-driver.js';

export type {
  AudioPlayback,
  AudioPlaybackState,
  AudioPlayResult,
  AudioPlaybackOptions,
} from './runtime/audio.js';
export type { AudioKey } from './runtime/audio-clips.js';

export type { AudioControls, ApplicationAudioOptions } from './runtime/application-audio.js';
export {
  defineSave,
  SaveService,
  SaveError,
  createLocalStorageAdapter,
} from './runtime/save-data.js';
export type {
  StorageAdapter,
  SaveOptions,
  SaveDefinition,
  SaveResult,
  SaveLoadResult,
  SaveNamespace,
  SaveResetResult,
} from './runtime/save-data.js';
export { AuthError, AuthService } from './runtime/auth.js';
export type {
  AuthProvider,
  AuthUser,
  AuthIdentity,
  AuthSession,
  AuthResult,
  AuthLogoutResult,
} from './runtime/auth.js';
export { AccessService, AccessError } from './runtime/access.js';
export type { AccessPolicy, AccessDecision } from './runtime/access.js';
export {
  createAccessGuard,
  resolveAccessReturnTarget,
  bindAccessRouter,
} from './runtime/access-router.js';
export type { AccessGuardOptions, AccessReturnOptions } from './runtime/access-router.js';
