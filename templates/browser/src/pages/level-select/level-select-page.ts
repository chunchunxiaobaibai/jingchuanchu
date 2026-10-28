import { computed, definePage, RouteLink } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';
import { levels, findLevel, type LevelId } from '../../game/session/levels.js';

export const LevelSelectPage = definePage({
  selector: 'game-level-select-page',
  components: [RouteLink],
  setup(context) {
    const game = context.useStore(GameStore);
    const preview = computed(() => findLevel(context.route()?.params.levelId));
    const previewTitle = computed(() => preview()?.title ?? '请选择想了解的关卡');
    const previewDescription = computed(
      () => preview()?.description ?? '查看关卡目标后，再确认这段旅程。',
    );
    const previewGoal = computed(() => {
      const level = preview();
      return level ? `${level.durationSeconds} 秒内收集 ${level.targetCount} 枚微光` : '';
    });
    const canChoose = computed(
      () => preview() !== null && preview()?.id !== game.state.selectedLevelId(),
    );
    const canStart = computed(
      () => preview() !== null && preview()?.id === game.state.selectedLevelId(),
    );
    const playTarget = computed(() => {
      const level = preview();
      return level
        ? { name: 'play' as const, params: { levelId: level.id } }
        : { name: 'level-select' as const };
    });
    const selectedTitle = computed(
      () => findLevel(game.state.selectedLevelId())?.title ?? '尚未选定',
    );
    const previewTarget = (levelId: LevelId) => ({
      name: 'level-preview' as const,
      params: { levelId },
    });
    const confirmLevel = () => {
      const level = preview();
      if (level) game.actions.selectLevel(level.id);
    };
    return {
      levels,
      previewTarget,
      previewTitle,
      previewDescription,
      previewGoal,
      canChoose,
      canStart,
      playTarget,
      selectedTitle,
      confirmLevel,
      nickname: game.state.nickname,
    };
  },
});
