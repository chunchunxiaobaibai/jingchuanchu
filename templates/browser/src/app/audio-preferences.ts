import { effect, type AudioControls } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { Scope, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { PreferencesStore } from '../game/preferences/preferences-store.js';
type Preferences = typeof PreferencesStore extends Token<infer T> ? T : never;

/** Apply validated shared preferences only when an actual optional app audio service exists. */
export function bindAudioPreferences(
  store: Preferences,
  audio: Pick<AudioControls, 'state' | 'restorePreferences'> | undefined,
  scope: Scope,
): Cleanup {
  if (!audio) {
    store.actions.reportBinding('unavailable');
    return () => {};
  }
  let closed = false,
    generation = 0;
  const stopPreferences = effect(() => {
    const value = store.state.audio(),
      ticket = ++generation;
    // Driver-side reactive reads must not become dependencies of the preference writer.
    queueMicrotask(() => {
      if (closed || ticket !== generation || value !== store.state.audio()) return;
      try {
        audio.restorePreferences(value);
        if (closed || ticket !== generation || value !== store.state.audio()) return;
        store.actions.reportDevice(audio.state());
        store.actions.reportBinding('applied');
      } catch {
        if (!closed) store.actions.reportBinding('failed');
      }
    });
  }, scope);
  const stopState = effect(() => store.actions.reportDevice(audio.state()), scope);
  const stop = () => {
    if (closed) return;
    closed = true;
    generation++;
    stopPreferences();
    stopState();
    store.actions.reportBinding('unavailable');
  };
  scope.own(stop);
  return stop;
}
