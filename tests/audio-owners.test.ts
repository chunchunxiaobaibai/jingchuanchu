import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { AUDIO_CONTEXT } from '../packages/app/runtime/context-keys.js';
import type { AudioContextProvider } from '../packages/app/runtime/audio-context.js';
import { Engine, type Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import {
  defineApplication,
  defineComponent,
  mountApplication,
  mountComponent,
  defineAssetGroup,
  defineGameScene,
  type AudioDriver,
  type AudioVoice,
  type AudioControls,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { getComponentMount } from '../packages/app/runtime/component-runtime.js';
import { createGameSceneAccess } from '../packages/app/runtime/game-scene-access.js';
import { adaptGameScene } from '../packages/app/runtime/game-scene.js';
import { ActionSampler, defineActions } from '../packages/app/runtime/input-actions.js';
import type { ComponentOwner } from '../packages/app/runtime/component-owner.js';
const Sounds = defineAssetGroup({
  name: 'owner-sounds',
  entries: { tone: { kind: 'audio', url: '/tone.bin' } },
});
const Child = defineComponent({
  selector: 'audio-owner-child',
  $template: '',
  setup(c) {
    return { audio: c.audio, scope: c.scope };
  },
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(initialHidden = false) {
  const window = new Window(),
    document = window.document as unknown as Document;
  let visibility = initialHidden ? 'hidden' : 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
  const host = document.createElement('div');
  document.body.append(host);
  let parent!: ComponentOwner,
    loads = 0,
    decodes = 0,
    released = 0,
    factories = 0,
    closed = 0,
    delayed = false;
  const voices: {
    voice: AudioVoice;
    stops: number;
    pauses: number;
    resumes: number;
    finish: () => void;
  }[] = [];
  const driver: AudioDriver = {
    unlock: async () => 'ready',
    async decode() {
      decodes++;
      return {};
    },
    release() {
      released++;
    },
    close() {
      closed++;
    },
    start() {
      const entry = {
        voice: undefined! as AudioVoice,
        stops: 0,
        pauses: 0,
        resumes: 0,
        finish: () => {},
      };
      entry.voice = {
        setGain() {},
        stop() {
          entry.stops++;
        },
        pause() {
          entry.pauses++;
        },
        resume() {
          entry.resumes++;
        },
      };
      voices.push(entry);
      return delayed
        ? new Promise<AudioVoice>((resolve) => {
            entry.finish = () => resolve(entry.voice);
          })
        : entry.voice;
    },
  };
  const Root = defineComponent({
    selector: 'audio-owner-root',
    $template: '',
    onMount(c) {
      parent = getComponentMount(c.scope)!.owner;
    },
  });
  const app = await mountApplication(
    host,
    defineApplication({
      root: Root,
      assets: {
        transport: () => ({
          async load() {
            loads++;
            return new ArrayBuffer(4);
          },
        }),
      },
      audio: {
        driver() {
          factories++;
          return driver;
        },
      },
    }),
  );
  await app.audio!.unlock();
  const child = () => {
    const node = document.createElement('div');
    host.append(node);
    return mountComponent(node, Child, { owner: parent });
  };
  return {
    app,
    hidden(value: boolean) {
      visibility = value ? 'hidden' : 'visible';
      document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
    },
    parent,
    child,
    voices,
    setActive(scope: Scope, active: boolean) {
      parent
        .getContext<AudioContextProvider>(AUDIO_CONTEXT)
        .setActive(getComponentMount(scope)!.owner, active);
    },
    delay() {
      delayed = true;
    },
    stats: () => ({ loads, decodes, released, factories, closed }),
  };
}

test('component exit stops only its own voices while sibling audio and app-shared decoding remain live', async () => {
  const f = await fixture(),
    a = f.child(),
    b = f.child();
  const aa = a.exposed.audio,
    bb = b.exposed.audio;
  assert.equal(aa.state(), 'ready');
  assert.equal(bb.state(), 'ready');
  assert.equal((await aa.playEffect(Sounds, 'tone')).status, 'played');
  assert.equal((await bb.playMusic(Sounds, 'tone')).status, 'played');
  assert.deepEqual(f.stats(), { loads: 1, decodes: 1, released: 0, factories: 1, closed: 0 });
  aa.pauseMusic();
  assert.equal(f.voices[1]!.pauses, 0);
  bb.pauseMusic();
  assert.equal(f.voices[1]!.pauses, 1);
  a.dispose();
  assert.equal(f.voices[0]!.stops, 1);
  assert.equal(f.voices[1]!.stops, 0);
  assert.equal(aa.state(), 'disposed');
  assert.equal(bb.state(), 'ready');
  assert.equal(f.stats().released, 0);
  assert.deepEqual(await aa.playEffect(Sounds, 'tone'), { status: 'cancelled' });
  assert.throws(() => aa.setMuted(true), /disposed/);
  b.dispose();
  assert.equal(f.voices[1]!.stops, 1);
  assert.equal(f.stats().released, 1);
  f.app.dispose();
  assert.equal(f.stats().closed, 1);
});

test('an exited owner cancels an ignored pending start and stops its late voice without affecting a sibling', async () => {
  const f = await fixture(),
    a = f.child(),
    b = f.child();
  await b.exposed.audio.playEffect(Sounds, 'tone');
  f.delay();
  const pending = a.exposed.audio.playEffect(Sounds, 'tone');
  await settle();
  a.dispose();
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(f.voices[0]!.stops, 0);
  f.voices[1]!.finish();
  await settle();
  assert.equal(f.voices[1]!.stops, 1);
  assert.equal(f.stats().released, 0);
  b.dispose();
  f.app.dispose();
  assert.equal(f.voices[0]!.stops, 1);
  assert.equal(f.stats().released, 1);
});

test('scene audio facade uses the scene owner and is cancelled when SceneManager retires it', async () => {
  const f = await fixture(),
    engine = new Engine(),
    scenes = new SceneManager(engine);
  f.parent.scope.own(() => engine.dispose());
  const neutral = new ActionSampler(defineActions({})).read();
  let audio: AudioControls | undefined, playing!: ReturnType<AudioControls['playEffect']>;
  const scene = defineGameScene({
    id: 'audio-scene',
    setup(c) {
      audio = c.audio;
      playing = c.audio.playEffect(Sounds, 'tone');
    },
  });
  const empty = defineGameScene({ id: 'empty', setup() {} });
  const services = (core: Parameters<Parameters<typeof scenes.switchTo>[0]['setup']>[0]) => {
    const access = createGameSceneAccess(f.parent, core.scope);
    return {
      get audio() {
        return access.audio;
      },
      get assets() {
        return access.assets;
      },
      useStore: access.useStore,
      useTheme: access.useTheme,
      readActions: () => neutral,
    };
  };
  await scenes.switchTo(adaptGameScene(scene, {}, services));
  assert.equal((await playing).status, 'played');
  await scenes.switchTo(adaptGameScene(empty, {}, services));
  assert.equal(f.voices[0]!.stops, 1);
  assert.equal(audio!.state(), 'disposed');
  assert.equal(f.app.audio!.state(), 'ready');
  assert.deepEqual(await audio!.playEffect(Sounds, 'tone'), { status: 'cancelled' });
  f.app.dispose();
  assert.equal(f.stats().closed, 1);
});

test('automatic owner pause preserves manual music pause and shared mute/volume preferences', async () => {
  const f = await fixture(),
    a = f.child(),
    audio = a.exposed.audio;
  await audio.playMusic(Sounds, 'tone');
  f.app.audio!.restorePreferences({
    muted: true,
    volumes: { master: 0.5, music: 0.4, effects: 0.2 },
  });
  f.setActive(a.exposed.scope, false);
  assert.equal(audio.state(), 'suspended');
  assert.equal(f.voices[0]!.pauses, 1);
  audio.resumeMusic();
  assert.equal(f.voices[0]!.resumes, 0);
  audio.pauseMusic();
  f.setActive(a.exposed.scope, true);
  assert.equal(f.voices[0]!.resumes, 0);
  audio.resumeMusic();
  assert.equal(f.voices[0]!.resumes, 1);
  assert.equal(audio.preferences().muted, true);
  assert.equal(audio.preferences().volumes.music, 0.4);
  f.setActive(a.exposed.scope, false);
  f.setActive(a.exposed.scope, true);
  assert.equal(f.voices[0]!.resumes, 2);
  f.app.dispose();
});

test('inactive owners reject new playback without loading and cancel pending effects without replay on activation', async () => {
  const f = await fixture(),
    a = f.child(),
    audio = a.exposed.audio;
  f.delay();
  const result = audio.playEffect(Sounds, 'tone');
  await settle();
  f.setActive(a.exposed.scope, false);
  assert.deepEqual(await result, { status: 'cancelled' });
  const before = f.stats().loads;
  assert.deepEqual(await audio.playEffect(Sounds, 'tone'), {
    status: 'blocked',
    reason: 'suspended',
  });
  assert.equal(f.stats().loads, before);
  f.voices[0]!.finish();
  await settle();
  assert.equal(f.voices[0]!.stops, 1);
  f.setActive(a.exposed.scope, true);
  assert.equal(f.voices.length, 1);
  assert.equal(audio.state(), 'ready');
  f.app.dispose();
});

test('component and ancestor activation combine with background visibility without clearing manual music pause', async () => {
  const f = await fixture(),
    a = f.child(),
    audio = a.exposed.audio;
  await audio.playMusic(Sounds, 'tone');
  audio.restorePreferences({ muted: true, volumes: { master: 0.7, music: 0.3, effects: 0.5 } });
  a.deactivate();
  assert.equal(audio.state(), 'suspended');
  assert.equal(f.voices[0]!.pauses, 1);
  audio.pauseMusic();
  f.app.root.deactivate();
  a.activate();
  f.hidden(true);
  f.hidden(false);
  assert.equal(audio.state(), 'suspended');
  assert.equal(f.voices[0]!.resumes, 0);
  f.app.root.activate();
  assert.equal(audio.state(), 'ready');
  assert.equal(f.voices[0]!.resumes, 0);
  audio.resumeMusic();
  assert.equal(f.voices[0]!.resumes, 1);
  assert.equal(audio.preferences().muted, true);
  assert.equal(audio.preferences().volumes.music, 0.3);
  f.app.dispose();
});

test('real scene pause and page activity remain separate through application visibility changes', async () => {
  const f = await fixture(),
    engine = new Engine(),
    scenes = new SceneManager(engine);
  f.parent.scope.own(() => engine.dispose());
  let audio!: AudioControls, playing!: ReturnType<AudioControls['playMusic']>;
  const scene = defineGameScene({
    id: 'paused-scene-audio',
    setup(c) {
      audio = c.audio;
      playing = audio.playMusic(Sounds, 'tone');
    },
  });
  const neutral = new ActionSampler(defineActions({})).read();
  await scenes.switchTo(
    adaptGameScene(scene, {}, (core) => {
      const access = createGameSceneAccess(f.parent, core.scope);
      return {
        setActive: access.setActive,
        get audio() {
          return access.audio;
        },
        get assets() {
          return access.assets;
        },
        useStore: access.useStore,
        useTheme: access.useTheme,
        readActions: () => neutral,
      };
    }),
  );
  assert.equal((await playing).status, 'played');
  scenes.pause();
  assert.equal(audio.state(), 'suspended');
  f.hidden(true);
  f.hidden(false);
  assert.equal(f.voices[0]!.resumes, 0);
  f.app.root.deactivate();
  scenes.resume();
  assert.equal(audio.state(), 'suspended');
  assert.equal(f.voices[0]!.resumes, 0);
  f.app.root.activate();
  assert.equal(audio.state(), 'ready');
  assert.equal(f.voices[0]!.resumes, 1);
  audio.pauseMusic();
  scenes.pause();
  scenes.resume();
  assert.equal(f.voices[0]!.resumes, 1);
  audio.resumeMusic();
  assert.equal(f.voices[0]!.resumes, 2);
  f.app.dispose();
});

test('audio first accessed while hidden is blocked immediately and visibility does not replay rejected requests', async () => {
  const f = await fixture(true),
    a = f.child();
  assert.equal(a.exposed.audio.state(), 'suspended');
  assert.deepEqual(await a.exposed.audio.playEffect(Sounds, 'tone'), {
    status: 'blocked',
    reason: 'suspended',
  });
  assert.equal(f.stats().loads, 0);
  f.app.root.deactivate();
  f.hidden(false);
  assert.equal(a.exposed.audio.state(), 'suspended');
  f.app.root.activate();
  assert.equal(a.exposed.audio.state(), 'ready');
  assert.equal(f.voices.length, 0);
  await a.exposed.audio.playEffect(Sounds, 'tone');
  assert.equal(f.voices.length, 1);
  f.app.dispose();
});
