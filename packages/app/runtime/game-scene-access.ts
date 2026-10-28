import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { AUDIO_CONTEXT } from './context-keys.js';
import type { AudioContextProvider } from './audio-context.js';
import { ComponentOwner } from './component-owner.js';
import { ASSETS_CONTEXT, THEME_CONTEXT } from './context-keys.js';
import type { AssetContextProvider } from './asset-service.js';
import type { ThemeContextProvider } from './theme-service.js';
import type { GameSceneAccess } from './game-scene.js';

/** Scene leases use a distinct owner; Store/theme lookup still follows the page provider chain. */
export function createGameSceneAccess(
  parent: ComponentOwner,
  scope: Scope,
): GameSceneAccess & { setActive(active: boolean): void } {
  // Manual child: the host stops input/frames before scene Scope disposal releases resources.
  const owner = new ComponentOwner(parent, {}, 'manual');
  let off: Cleanup | undefined;
  const close = (): void => {
    off?.();
    off = undefined;
    owner.dispose();
  };
  off = parent.cancellation.subscribe(close);
  scope.own(close);
  owner.assertOpen();
  return Object.freeze({
    setActive: (active: boolean) => owner.setActive(active),
    get audio() {
      return owner.getContext<AudioContextProvider>(AUDIO_CONTEXT).forOwner(owner);
    },
    get assets() {
      return owner.getContext<AssetContextProvider>(ASSETS_CONTEXT).forOwner(owner);
    },
    useStore: (token) => owner.resolve('stores', token),
    useTheme: (contract) =>
      owner.getContext<ThemeContextProvider>(THEME_CONTEXT).forOwner(owner, contract),
  });
}
