import {
  computed,
  definePage,
  signal,
  RouteLink,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore, normalizePlayerName } from '../../game/session/game-store.js';

export const HomePage = definePage({
  selector: 'game-home-page',
  components: [RouteLink],
  setup(context) {
    const game = context.useStore(GameStore);
    const draft = signal(game.state.nickname());
    const normalized = computed(() => normalizePlayerName(draft()));
    const valid = computed(() => normalized() !== null);
    const preview = computed(() => normalized() ?? '请填写昵称');
    const canSave = computed(() => valid() && normalized() !== game.state.nickname());
    const saveName = (event: Event) => {
      event.preventDefault();
      if (canSave() && game.actions.rename(draft())) draft.set(game.state.nickname());
    };
    return { draft, valid, preview, canSave, savedName: game.state.nickname, saveName };
  },
});
