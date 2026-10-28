import {
  computed,
  definePage,
  effect,
  GameCanvas,
  input,
  RouteLink,
  signal,
  type GameCanvasHandle,
  type AudioControls,
  type AudioPlayback,
  type GameCanvasOptions,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';
import { findLevel, type LevelId } from '../../game/session/levels.js';
import { GameHud } from './hud/hud.js';
import { PausePanel } from './pause-panel/pause-panel.js';
import { PlayScene, playBounds } from './play-scene.js';
import { DefaultTheme } from '../../themes/default/default-theme.js';
import { GameSounds } from '../../assets/audio/game-sounds.js';
import { createThemedPlayScene } from './themed-play-scene.js';

const canvasOptions: GameCanvasOptions = Object.freeze({
  width: playBounds.width,
  height: playBounds.height,
  background: '#172031',
  maxPixelRatio: 2,
});
export const PlayPage = definePage({
  selector: 'game-play-page',
  inputs: { levelId: input<LevelId>({ required: true }) },
  components: [GameCanvas, GameHud, PausePanel, RouteLink],
  setup(context) {
    const theme = context.useTheme(DefaultTheme),
      audio = context.audio;
    const unlockingAudio = signal(false),
      audioNotice = signal(
        audio.state() === 'ready'
          ? '音频服务已就绪，可点击试听。'
          : '声音尚未启用，可点击启用并试听。',
      );
    let soundRequest = 0,
      pageSound: AudioPlayback | undefined;
    context.own(() => {
      soundRequest++;
      pageSound?.stop();
    });
    const playSound = async (
      owner: AudioControls,
      key: keyof typeof GameSounds.entries,
      run?: number,
      label = '游戏音效',
    ) => {
      const ticket = ++soundRequest;
      if (owner === audio) {
        pageSound?.stop();
        pageSound = undefined;
      }
      audioNotice.set(`${label}正在加载…`);
      const result = await owner.playEffect(GameSounds, key);
      if (
        context.signal.aborted ||
        ticket !== soundRequest ||
        (run !== undefined && run !== game.state.runId())
      ) {
        if (result.status === 'played') result.playback.stop();
        return;
      }
      if (result.status === 'played' && owner === audio) pageSound = result.playback;
      audioNotice.set(
        result.status === 'played'
          ? audio.preferences().muted
            ? `${label}已启动（当前静音）。`
            : `${label}已启动。`
          : result.status === 'blocked'
            ? '音效未启动：设备受限、页面暂停或并发已满。'
            : result.status === 'failed'
              ? '音效加载或播放失败，可再次尝试。'
              : '音效已取消。',
      );
    };
    const unlockAudio = async () => {
      if (unlockingAudio() || context.signal.aborted) return;
      unlockingAudio.set(true);
      const ticket = ++soundRequest;
      audioNotice.set('正在启用声音…');
      try {
        // Invoke within this actual event handler, before awaiting or fetching sound bytes.
        const unlocked = await audio.unlock();
        if (context.signal.aborted || ticket !== soundRequest) return;
        if (unlocked.status !== 'ready') {
          audioNotice.set(
            unlocked.status === 'blocked'
              ? '设备尚未解锁，请再次点击启用声音。'
              : unlocked.status === 'failed'
                ? '声音启用失败，可再次尝试。'
                : '声音启用已取消。',
          );
          return;
        }
        await playSound(audio, 'collect', undefined, '试听音效');
      } finally {
        if (!context.signal.aborted) unlockingAudio.set(false);
      }
    };
    const game = context.useStore(GameStore),
      level = findLevel(context.inputs.levelId());
    if (!level) throw new Error('Unknown game level');
    const paused = signal(false),
      ready = signal(false),
      restarting = signal(false),
      issue = signal('');
    const mountCanvas = signal(false),
      assetsReady = signal(false),
      loading = signal(false);
    const assetIssue = signal('');
    let scene = PlayScene;
    const loadVisuals = async () => {
      if (loading() || context.signal.aborted || assetsReady()) return;
      loading.set(true);
      assetIssue.set('');
      try {
        const icon = await theme.load('game.collectible', { signal: context.signal });
        if (context.signal.aborted) {
          icon.release();
          return;
        }
        scene = createThemedPlayScene(icon, theme.tokens.player, {
          collected(owner, run) {
            void playSound(owner, 'collect', run, '收集音效');
          },
          finished(outcome, run) {
            void playSound(
              audio,
              outcome === 'cleared' ? 'complete' : 'timeout',
              run,
              outcome === 'cleared' ? '通关音效' : '超时音效',
            );
          },
        });
        assetsReady.set(true);
      } catch {
        if (!context.signal.aborted) assetIssue.set('道具图片加载失败，可重试或返回选关。');
      } finally {
        if (!context.signal.aborted) loading.set(false);
      }
    };
    void loadVisuals();
    effect(() => {
      if (mountCanvas() || !assetsReady() || context.router.pending()) return;
      if (context.router.current()?.fullPath === context.route()?.fullPath) mountCanvas.set(true);
    }, context.scope);
    const previousRun = signal(game.state.runId());
    const ownsRun = computed(
      () => game.state.runId() > previousRun() && game.state.sessionLevelId() === level.id,
    );
    const finished = computed(() => ownsRun() && game.state.phase() === 'finished');
    const playing = computed(() => ownsRun() && game.state.phase() === 'playing');
    const score = computed(() => (ownsRun() ? game.state.score() : 0));
    const remaining = computed(() =>
      ownsRun() ? game.state.remainingSeconds() : level.durationSeconds,
    );
    const resultTitle = computed(() =>
      game.state.outcome() === 'cleared' ? '收集完成！' : '时间到了',
    );
    let handle: GameCanvasHandle | undefined;
    const applyPause = () => {
      const stop = paused() || finished() || restarting();
      if (handle) {
        if (stop) handle.pause();
        else handle.resume();
      }
    };
    effect(applyPause, context.scope);
    context.own(() => {
      handle = undefined;
    });
    const onReady = (value: GameCanvasHandle) => {
      if (context.signal.aborted) return;
      handle = value;
      ready.set(true);
      applyPause();
    };
    const onError = () => {
      if (!context.signal.aborted) issue.set('本关暂时无法继续，请重试或返回选关。');
    };
    const restart = async () => {
      if (!handle || restarting()) return;
      soundRequest++;
      pageSound?.stop();
      pageSound = undefined;
      const priorBaseline = previousRun();
      previousRun.set(game.state.runId());
      restarting.set(true);
      issue.set('');
      handle.pause();
      try {
        await handle.restart();
        if (!context.signal.aborted) {
          paused.set(false);
          restarting.set(false);
          applyPause();
        }
      } catch {
        if (!context.signal.aborted) {
          previousRun.set(priorBaseline);
          restarting.set(false);
          onError();
          applyPause();
        }
      }
    };
    const virtual = (axis: 'horizontal' | 'vertical', value: number, source: string) => {
      if (!handle || !playing() || paused() || restarting() || issue() !== '') return;
      handle.forScene(scene).setVirtual(axis, value, source);
    };
    const press = (
      axis: 'horizontal' | 'vertical',
      value: number,
      source: string,
      event: PointerEvent,
    ) => {
      if (event.button !== 0 || controlsDisabled()) return;
      event.preventDefault();
      const button = event.currentTarget as HTMLButtonElement;
      button.setPointerCapture?.(event.pointerId);
      virtual(axis, value, source);
    };
    const release = (axis: 'horizontal' | 'vertical', source: string) => virtual(axis, 0, source);
    const onKeydown = (event: KeyboardEvent) => {
      if (
        event.code !== 'Escape' ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !ready() ||
        issue() !== '' ||
        restarting() ||
        finished()
      )
        return;
      event.preventDefault();
      paused.set(!paused());
      applyPause();
    };
    const controlsDisabled = computed(
      () => !ready() || !playing() || paused() || restarting() || issue() !== '',
    );
    return {
      unlockAudio,
      unlockingAudio,
      audioNotice,
      mountCanvas,
      pauseIcon: theme.resolve('ui.pause').src,
      settingsIcon: theme.resolve('ui.settings').src,
      getScene: () => scene,
      loading,
      assetIssue,
      loadVisuals,
      options: { ...canvasOptions, background: theme.tokens.background },
      sceneProps: { levelId: level.id },
      levelTitle: level.title,
      paused,
      ready,
      restarting,
      issue,
      finished,
      resultTitle,
      score,
      remaining,
      controlsDisabled,
      hudDisabled: computed(() => !ready() || restarting() || finished() || issue() !== ''),
      onReady,
      onError,
      restart,
      onKeydown,
      press,
      release,
    };
  },
});
