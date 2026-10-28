import {
  batch,
  defineSave,
  type AudioPreferences,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { GameStore, normalizePlayerName } from '../session/game-store.js';
import { PreferencesStore, parseAudioPreferences } from './preferences-store.js';

type Instance<D> = D extends Token<infer T> ? T : never;
interface SettingsState {
  game: Instance<typeof GameStore>;
  preferences: Instance<typeof PreferencesStore>;
}
interface SettingsData {
  nickname: string;
  audio: AudioPreferences;
}
function parseSettings(value: unknown): SettingsData {
  if (
    !value ||
    typeof value !== 'object' ||
    !('nickname' in value) ||
    typeof value.nickname !== 'string' ||
    !('audio' in value)
  )
    throw new Error('Invalid settings');
  const nickname = normalizePlayerName(value.nickname);
  if (nickname === null) throw new Error('Invalid saved nickname');
  return { nickname, audio: parseAudioPreferences(value.audio) };
}
export const SettingsSave = defineSave<SettingsState, SettingsData>({
  key: 'collect-light/settings',
  version: 1,
  select: ({ game, preferences }) => ({
    nickname: game.state.nickname(),
    audio: parseAudioPreferences(preferences.state.audio()),
  }),
  parse: parseSettings,
  restore(state, data) {
    const parsed = parseSettings(data);
    batch(() => {
      state.game.actions.rename(parsed.nickname);
      state.preferences.actions.restore(parsed.audio);
    });
  },
});
