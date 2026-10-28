import {
  computed,
  definePage,
  RouteLink,
  signal,
  writableModel,
  type AudioGroup,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore, normalizePlayerName } from '../../game/session/game-store.js';
import { PreferencesStore } from '../../game/preferences/preferences-store.js';
import { GameStorage } from '../../game/preferences/settings-storage.js';
import { SettingsSave } from '../../game/preferences/settings-save.js';
export const SettingsPage = definePage({
  selector: 'game-settings-page',
  components: [RouteLink],
  setup(context) {
    const game = context.useStore(GameStore),
      preferences = context.useStore(PreferencesStore);
    const storage = context.useService(GameStorage);
    const draft = signal(game.state.nickname()),
      notice = signal(''),
      storageNotice = signal(''),
      busy = signal(false);
    let editRevision = 0,
      request = 0;
    const name = writableModel<string>({
      get: () => draft(),
      set: (value) => {
        editRevision++;
        draft.set(value);
      },
    });
    const state = { game, preferences };
    const fingerprint = () => JSON.stringify([draft(), SettingsSave.select(state)]);
    const canSave = computed(() => !busy() && normalizePlayerName(draft()) !== null);
    const persist = async (load: boolean) => {
      if (busy() || context.signal.aborted || (!load && !canSave())) return;
      if (!load) {
        game.actions.rename(draft());
        draft.set(game.state.nickname());
      }
      const ticket = ++request,
        revision = editRevision,
        before = fingerprint();
      busy.set(true);
      storageNotice.set(load ? '正在读取设置…' : '正在保存设置…');
      if (load) {
        const result = await storage.load(SettingsSave);
        if (context.signal.aborted || ticket !== request) return;
        if (result.status === 'loaded') {
          if (revision !== editRevision || before !== fingerprint())
            storageNotice.set('读取期间设置已改动，未覆盖当前设置。');
          else {
            SettingsSave.restore(state, result.data);
            draft.set(game.state.nickname());
            storageNotice.set('已读取保存的设置。');
          }
        } else {
          const messages = {
            empty: '尚无保存的设置。',
            corrupt: '设置记录损坏，原记录已保留，当前设置未更改。',
            incompatible: '设置记录版本不兼容，原记录已保留，当前设置未更改。',
            unavailable: '存储不可用，读取失败，当前设置未更改。',
          };
          storageNotice.set(messages[result.status]);
        }
      } else {
        const result = await storage.save(SettingsSave, state);
        if (context.signal.aborted || ticket !== request) return;
        storageNotice.set(
          result.status === 'saved'
            ? revision === editRevision && before === fingerprint()
              ? '设置已保存。'
              : '已保存操作开始时的设置，后续改动尚未保存。'
            : result.status === 'unavailable'
              ? '存储不可用，保存失败。'
              : '设置无效，未保存。',
        );
      }
      busy.set(false);
    };
    const save = () => persist(false),
      load = () => persist(true);
    const canApplyName = computed(
      () =>
        normalizePlayerName(draft()) !== null &&
        normalizePlayerName(draft()) !== game.state.nickname(),
    );
    const applyName = (event: Event) => {
      event.preventDefault();
      if (canApplyName() && game.actions.rename(draft())) {
        draft.set(game.state.nickname());
        notice.set('本次旅程昵称已更新。');
      }
    };
    const volume = (group: AudioGroup) =>
      writableModel<number>({
        get: () => preferences.state.audio().volumes[group],
        set: (value) => {
          editRevision++;
          preferences.actions.setVolume(group, value);
        },
        convert: 'number',
      });
    const muted = writableModel<boolean>({
      get: () => preferences.state.audio().muted,
      set: (value) => {
        editRevision++;
        preferences.actions.setMuted(value);
      },
    });
    const percent = (group: AudioGroup) =>
      computed(() => Math.round(preferences.state.audio().volumes[group] * 100));
    const audioStatus = computed(() => {
      if (preferences.state.binding() === 'unavailable')
        return '音频设备尚未接入，当前仅调整本次旅程偏好。';
      if (preferences.state.binding() === 'failed')
        return '音频偏好应用失败，当前设置仍保留在本次旅程。';
      return preferences.state.device() === 'ready'
        ? '音频服务已接收偏好。'
        : '音频服务已接收偏好，等待设备解锁或恢复。';
    });
    return {
      name,
      save,
      load,
      busy,
      canSave,
      storageNotice,
      canApplyName,
      applyName,
      notice,
      master: volume('master'),
      music: volume('music'),
      effects: volume('effects'),
      muted,
      masterPercent: percent('master'),
      musicPercent: percent('music'),
      effectsPercent: percent('effects'),
      audioStatus,
    };
  },
});
