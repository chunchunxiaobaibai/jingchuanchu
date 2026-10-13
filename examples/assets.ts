import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { assetModule } from '@xiaobaibaifqy/jingchuanchu-assets/module';

let loads = 0;
const released: string[] = [];
const assets = assetModule({
  id: 'text-assets',
  load: async (url: string) => {
    loads++;
    return `content:${url}`;
  },
  release: (value) => {
    released.push(value);
  },
});
const engine = new Engine();
engine.install([assets]);
const cache = engine.world.getResource(assets.cache);
const [one, two] = await Promise.all([cache.get('level-1'), cache.get('level-1')]);
if (one !== two || loads !== 1) throw new Error('Asset loads were not shared');
engine.dispose();
await Promise.resolve();
if (released.length !== 1) throw new Error('Asset was not released');
console.log('Shared asset loading and release passed');
