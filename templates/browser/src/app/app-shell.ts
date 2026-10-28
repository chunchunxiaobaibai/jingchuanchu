import { defineComponent, RouterOutlet } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { PreferencesStore } from '../game/preferences/preferences-store.js';
export const AppShell = defineComponent({
  selector: 'game-app',
  components: [RouterOutlet],
  setup(context) {
    return { preferences: context.useStore(PreferencesStore) };
  },
});
