import { defineService, SaveService } from '@xiaobaibaifqy/jingchuanchu-app/application';

/** Construction is lazy; storage is accessed only by explicit save/load actions. */
export const GameStorage = defineService({
  name: 'game-storage',
  factory: () => new SaveService(),
});
