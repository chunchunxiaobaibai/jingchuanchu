import { defineStore, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { findLevel, type LevelId } from '../session/levels.js';
import type { RunOutcome } from '../session/game-store.js';

export interface LevelProgress {
  bestScore: number;
  completed: boolean;
}
export type ProgressData = Partial<Record<LevelId, LevelProgress>>;

/** Validate the whole record before any Store mutation, copying only persistent fields. */
export function parseProgress(value: unknown): ProgressData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid game progress');
  const result: ProgressData = {};
  for (const [id, entry] of Object.entries(value)) {
    const level = findLevel(id);
    if (!level || !entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Invalid level progress');
    const { bestScore, completed } = entry as Record<string, unknown>;
    if (
      typeof bestScore !== 'number' ||
      !Number.isSafeInteger(bestScore) ||
      bestScore < 0 ||
      bestScore > level.targetCount ||
      typeof completed !== 'boolean' ||
      (completed && bestScore !== level.targetCount)
    )
      throw new Error('Invalid level result');
    result[level.id] = { bestScore, completed };
  }
  return result;
}

export const ProgressStore = defineStore({
  name: 'game-progress',
  setup() {
    const levels = signal<ProgressData>({});
    const merge = (incoming: ProgressData) => {
      const next = { ...levels() };
      for (const [id, entry] of Object.entries(incoming)) {
        const key = id as LevelId,
          previous = next[key];
        next[key] = {
          bestScore: Math.max(previous?.bestScore ?? 0, entry.bestScore),
          completed: (previous?.completed ?? false) || entry.completed,
        };
      }
      levels.set(next);
    };
    return {
      state: { levels },
      getters: {},
      actions: {
        recordResult(levelId: LevelId, score: number, outcome: RunOutcome): boolean {
          if (!findLevel(levelId) || !['cleared', 'timeout'].includes(outcome)) return false;
          try {
            const incoming = parseProgress({
              [levelId]: { bestScore: score, completed: outcome === 'cleared' },
            });
            merge(incoming);
            return true;
          } catch {
            return false;
          }
        },
        /** Loading an older save never rolls back progress earned in the current application. */
        restore(value: unknown): void {
          merge(parseProgress(value));
        },
      },
    };
  },
});
