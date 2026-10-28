import {
  defineService,
  provideService,
  defineComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
const Config = defineService({
  name: 'config',
  factory() {
    return { title: 'game', count: 1 };
  },
});
provideService(Config, () => ({ title: 'page', count: 2 }));
// @ts-expect-error override must preserve the service value type
provideService(Config, () => ({ title: 1, count: 2 }));
// @ts-expect-error factories are synchronous; async work belongs in service methods
defineService({
  name: 'async',
  async factory() {
    return 1;
  },
});
const owner = new ComponentOwner(),
  config = owner.resolve('services', Config);
const title: string = config.title;
// @ts-expect-error typed value has no missing property
config.missing;
const Hud = defineComponent({
  selector: 'service-hud',
  setup(context) {
    const settings = context.useService(Config);
    const count: number = settings.count;
    return { count };
  },
});
void title;
void Hud;
