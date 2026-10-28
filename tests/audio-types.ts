import { defineAssetGroup, type AudioControls } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AssetContext } from '../packages/app/runtime/asset-types.js';
import type { AudioService } from '../packages/app/runtime/audio.js';
import type { AudioClipCache } from '../packages/app/runtime/audio-clips.js';
const group = defineAssetGroup({
  name: 'mixed',
  entries: {
    tone: { kind: 'audio', url: '/tone.bin' },
    image: { kind: 'image', url: '/image.png' },
  },
});
function keys(cache: AudioClipCache, assets: AssetContext, signal: CancellationSignal) {
  void cache.load(assets, group, 'tone', signal);
  // @ts-expect-error only audio entries are accepted
  void cache.load(assets, group, 'image', signal);
  // @ts-expect-error unknown resource names are rejected
  void cache.load(assets, group, 'missing', signal);
}
void keys;

function playback(audio: AudioService) {
  void audio.playMusic(group, 'tone');
  // @ts-expect-error playback accepts only audio keys
  void audio.playEffect(group, 'image');
  void audio.playEffect(group, 'tone').then((result) => {
    if (result.status === 'played') result.playback.stop();
    // @ts-expect-error only played results carry a playback handle
    result.playback;
  });
}
void playback;

function publicControls(audio: AudioControls) {
  void audio.playMusic(group, 'tone');
  // @ts-expect-error app controls retain typed audio keys
  void audio.playEffect(group, 'image');
  // @ts-expect-error public state is readonly
  audio.state.set('ready');
  audio.setVolume('music', 0.5);
  audio.restorePreferences({ muted: true, volumes: { master: 1, music: 0.5, effects: 0.3 } });
  // @ts-expect-error restoring preferences requires the complete volume record
  audio.restorePreferences({ muted: false, volumes: { master: 1 } });
}
void publicControls;
