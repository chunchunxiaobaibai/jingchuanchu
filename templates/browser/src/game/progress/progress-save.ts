import { defineSave } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { ProgressStore, parseProgress, type ProgressData } from './progress-store.js';

type Progress = typeof ProgressStore extends Token<infer T> ? T : never;
export const ProgressSave = defineSave<Progress, ProgressData>({
  key: 'collect-light/progress',
  version: 1,
  select: (state) => parseProgress(state.state.levels()),
  parse: parseProgress,
  restore: (state, data) => state.actions.restore(data),
});
