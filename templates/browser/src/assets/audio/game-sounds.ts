import { defineAssetGroup } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const GameSounds = defineAssetGroup({
  name: 'collect-light-sounds',
  entries: {
    collect: { kind: 'audio', url: new URL('./collect.wav', import.meta.url).href },
    complete: { kind: 'audio', url: new URL('./complete.wav', import.meta.url).href },
    timeout: { kind: 'audio', url: new URL('./timeout.wav', import.meta.url).href },
  },
});
