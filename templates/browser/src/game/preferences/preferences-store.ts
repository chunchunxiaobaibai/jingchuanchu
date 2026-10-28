import {
  defineStore,
  signal,
  type AudioGroup,
  type AudioPreferences,
  type AudioState,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

export function parseAudioPreferences(value: unknown): AudioPreferences {
  if (
    !value ||
    typeof value !== 'object' ||
    !('muted' in value) ||
    typeof value.muted !== 'boolean' ||
    !('volumes' in value) ||
    !value.volumes ||
    typeof value.volumes !== 'object'
  )
    throw new Error('Invalid audio preferences');
  const volumes = value.volumes as Record<string, unknown>;
  for (const key of ['master', 'music', 'effects'])
    if (
      typeof volumes[key] !== 'number' ||
      !Number.isFinite(volumes[key]) ||
      volumes[key] < 0 ||
      volumes[key] > 1
    )
      throw new Error('Invalid volume');
  return {
    muted: value.muted,
    volumes: {
      master: volumes.master as number,
      music: volumes.music as number,
      effects: volumes.effects as number,
    },
  };
}
export const PreferencesStore = defineStore({
  name: 'game-preferences',
  setup() {
    const audio = signal<AudioPreferences>({
      volumes: { master: 1, music: 0.6, effects: 0.8 },
      muted: false,
    });
    const binding = signal<'unavailable' | 'applied' | 'failed'>('unavailable');
    const device = signal<AudioState | null>(null);
    return {
      state: { audio, binding, device },
      getters: {},
      actions: {
        setVolume(group: AudioGroup, value: number): boolean {
          if (
            !['master', 'music', 'effects'].includes(group) ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 1
          )
            return false;
          audio.set({ ...audio(), volumes: { ...audio().volumes, [group]: value } });
          return true;
        },
        setMuted(value: boolean): void {
          if (typeof value === 'boolean') audio.set({ ...audio(), muted: value });
        },
        restore(value: unknown): void {
          audio.set(parseAudioPreferences(value));
        },
        reportBinding(value: 'unavailable' | 'applied' | 'failed'): void {
          binding.set(value);
        },
        reportDevice(value: AudioState): void {
          device.set(value);
        },
      },
    };
  },
});
