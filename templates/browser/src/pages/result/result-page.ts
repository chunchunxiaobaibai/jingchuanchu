import {
  computed,
  definePage,
  RouteLink,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';
import { findLevel, levels } from '../../game/session/levels.js';
import { ProgressStore } from '../../game/progress/progress-store.js';
import { ProgressSave } from '../../game/progress/progress-save.js';
import { GameStorage } from '../../game/preferences/settings-storage.js';

export const ResultPage = definePage({
  selector: 'game-result-page',
  components: [RouteLink],
  setup(context) {
    const game = context.useStore(GameStore),
      progress = context.useStore(ProgressStore),
      storage = context.useService(GameStorage);
    const level = computed(() => findLevel(game.state.sessionLevelId()));
    const hasResult = computed(
      () => game.state.phase() === 'finished' && level() !== null && game.state.outcome() !== null,
    );
    const resultTitle = computed(() =>
      game.state.outcome() === 'cleared' ? '收集完成！' : '时间到了',
    );
    const replayTarget = computed(() =>
      level()
        ? { name: 'play' as const, params: { levelId: level()!.id } }
        : { name: 'level-select' as const },
    );
    const busy = signal(false),
      notice = signal('');
    const persist = async (load: boolean) => {
      if (busy() || context.signal.aborted) return;
      busy.set(true);
      notice.set(load ? '正在读取进度…' : '正在保存进度…');
      if (load) {
        const result = await storage.load(ProgressSave);
        if (context.signal.aborted) return;
        if (result.status === 'loaded') {
          ProgressSave.restore(progress, result.data);
          notice.set('已读取进度，保留本次旅程中更高的成绩。');
        } else {
          const messages = {
            empty: '尚无保存的进度。',
            corrupt: '进度记录损坏，原记录已保留，当前进度未更改。',
            incompatible: '进度记录版本不兼容，原记录已保留，当前进度未更改。',
            unavailable: '存储不可用，读取失败，当前进度未更改。',
          };
          notice.set(messages[result.status]);
        }
      } else {
        const before = JSON.stringify(ProgressSave.select(progress));
        const result = await storage.save(ProgressSave, progress);
        if (context.signal.aborted) return;
        notice.set(
          result.status === 'saved'
            ? before === JSON.stringify(ProgressSave.select(progress))
              ? '进度已保存。'
              : '已保存操作开始时的进度，后续成绩尚未保存。'
            : result.status === 'unavailable'
              ? '存储不可用，保存失败。'
              : '进度无效，未保存。',
        );
      }
      busy.set(false);
    };
    return {
      hasResult,
      resultTitle,
      levelTitle: computed(() => level()?.title ?? ''),
      score: game.state.score,
      replayTarget,
      busy,
      notice,
      save: () => persist(false),
      load: () => persist(true),
      records: computed(() =>
        levels.map((level) => ({
          id: level.id,
          title: level.title,
          bestScore: progress.state.levels()[level.id]?.bestScore ?? 0,
          status: progress.state.levels()[level.id]?.completed ? '已通关' : '未通关',
        })),
      ),
    };
  },
});
