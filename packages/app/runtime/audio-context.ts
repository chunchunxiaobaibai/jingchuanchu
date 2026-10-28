import { Cancellation, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { SIGNAL, signal, type ReadSignal } from './reactivity.js';
import { AudioError, type AudioState } from './audio-driver.js';
import type { AudioControls } from './application-audio.js';
import type { AudioService, AudioOwner } from './audio.js';
import type { ComponentOwner } from './component-owner.js';
import { ASSETS_CONTEXT } from './context-keys.js';
import type { AssetContextProvider } from './asset-service.js';
export interface AudioContextProvider {
  forOwner(owner: ComponentOwner): AudioControls;
  setActive(owner: ComponentOwner, active: boolean): void;
}
interface Entry {
  controls: AudioControls;
  assertOpen(): void;
  setActive(active: boolean): void;
  sync(): void;
}
/** One app service; effective activity combines owner ancestry, scene activity and background state. */
export class OwnerAudioContexts implements AudioContextProvider {
  private readonly contexts = new WeakMap<ComponentOwner, Entry>();
  private readonly entries = new Set<Entry>();
  private backgroundActive = true;
  constructor(private readonly service: AudioService) {}
  setActive(owner: ComponentOwner, active: boolean): void {
    this.contexts.get(owner)?.setActive(active);
  }
  setBackground(active: boolean): void {
    if (this.backgroundActive === active) return;
    this.backgroundActive = active;
    for (const entry of [...this.entries]) if (this.entries.has(entry)) entry.sync();
  }
  forOwner(owner: ComponentOwner): AudioControls {
    owner.assertOpen();
    const cached = this.contexts.get(owner);
    if (cached) {
      cached.assertOpen();
      return cached.controls;
    }
    const cancellation = new Cancellation(),
      closed = signal(false),
      active = signal(true);
    let requested = true,
      applied: boolean | undefined,
      entry: Entry | undefined;
    let off: Cleanup | undefined, offActivity: Cleanup | undefined;
    const assertOpen = (): void => {
      owner.assertOpen();
      if (closed())
        throw new AudioError(
          '<owner>',
          '<context>',
          'access',
          new Error('Audio owner is disposed'),
        );
    };
    const close = (): void => {
      if (closed()) return;
      closed.set(true);
      off?.();
      off = undefined;
      offActivity?.();
      offActivity = undefined;
      if (entry) this.entries.delete(entry);
      try {
        cancellation.cancel();
      } finally {
        this.service.forgetOwner(owner);
      }
    };
    off = owner.cancellation.subscribe(close);
    owner.scope.own(close);
    assertOpen();
    const assets = owner.getContext<AssetContextProvider>(ASSETS_CONTEXT).forOwner(owner);
    const lifetime: AudioOwner = { key: owner, signal: cancellation, assets };
    const controls = Object.freeze<AudioControls>({
      state: Object.freeze(
        Object.defineProperty(
          (): AudioState =>
            closed()
              ? 'disposed'
              : !active() && this.service.mixer.state() === 'ready'
                ? 'suspended'
                : this.service.mixer.state(),
          SIGNAL,
          { value: true },
        ),
      ) as ReadSignal<AudioState>,
      preferences: this.service.mixer.preferences,
      unlock: () =>
        closed() ? Promise.resolve({ status: 'cancelled' as const }) : this.service.mixer.unlock(),
      playMusic: (group, key, options) => this.service.playMusic(group, key, options, lifetime),
      playEffect: (group, key, options) => this.service.playEffect(group, key, options, lifetime),
      pauseMusic: () => {
        assertOpen();
        this.service.pauseMusic(owner);
      },
      resumeMusic: () => {
        assertOpen();
        this.service.resumeMusic(owner);
      },
      setVolume: (group, value) => {
        assertOpen();
        this.service.mixer.setVolume(group, value);
      },
      setMuted: (value) => {
        assertOpen();
        this.service.mixer.setMuted(value);
      },
      restorePreferences: (value) => {
        assertOpen();
        this.service.mixer.restorePreferences(value);
      },
    });
    const sync = (): void => {
      if (closed()) return;
      const next = requested && owner.active && this.backgroundActive;
      if (next === applied) return;
      applied = next;
      active.set(next);
      this.service.setOwnerActive(owner, next);
    };
    entry = {
      controls,
      assertOpen,
      sync,
      setActive(value) {
        assertOpen();
        requested = value;
        sync();
      },
    };
    this.contexts.set(owner, entry);
    this.entries.add(entry);
    offActivity = owner.onActivity(sync);
    sync();
    return controls;
  }
}
