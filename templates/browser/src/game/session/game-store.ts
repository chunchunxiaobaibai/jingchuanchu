import { batch, defineStore, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ProgressStore } from '../progress/progress-store.js';
import { findLevel, type LevelId } from './levels.js';

export function normalizePlayerName(value: string): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && Array.from(name).length <= 16 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

export type RunOutcome = 'cleared' | 'timeout';

/** Shared across pages of one game application; never stores active Canvas/Entity objects. */
export const GameStore = defineStore({
  name: 'game-session',
  setup(context) {
    const progress = context.useStore(ProgressStore);
    const nickname = signal('旅行者');
    const selectedLevelId = signal<LevelId | null>(null);
    const phase = signal<'idle' | 'playing' | 'finished'>('idle');
    const runId = signal(0);
    const score = signal(0),
      remainingSeconds = signal(0);
    const sessionLevelId = signal<LevelId | null>(null);
    const outcome = signal<RunOutcome | null>(null);
    let generation = 0;
    const active = (run: number) => run === generation && phase() === 'playing';
    return {
      state: {
        runId,
        nickname,
        selectedLevelId,
        phase,
        score,
        remainingSeconds,
        sessionLevelId,
        outcome,
      },
      getters: {},
      actions: {
        beginRun(levelId: LevelId): number {
          const level = findLevel(levelId);
          if (!level) throw new Error('Unknown game level');
          const run = ++generation;
          batch(() => {
            runId.set(run);
            sessionLevelId.set(level.id);
            selectedLevelId.set(level.id);
            score.set(0);
            remainingSeconds.set(level.durationSeconds);
            outcome.set(null);
            phase.set('playing');
          });
          return run;
        },
        updateRemaining(run: number, seconds: number): boolean {
          if (
            !active(run) ||
            !Number.isFinite(seconds) ||
            seconds < 0 ||
            seconds > remainingSeconds()
          )
            return false;
          remainingSeconds.set(seconds);
          return true;
        },
        collect(run: number): boolean {
          if (!active(run)) return false;
          score.update((value) => value + 1);
          return true;
        },
        finishRun(run: number, reason: RunOutcome): boolean {
          if (!active(run) || !['cleared', 'timeout'].includes(reason)) return false;
          batch(() => {
            const levelId = sessionLevelId();
            if (levelId) progress.actions.recordResult(levelId, score(), reason);
            if (reason === 'timeout') remainingSeconds.set(0);
            outcome.set(reason);
            phase.set('finished');
          });
          return true;
        },
        endRun(run: number): void {
          if (run !== generation) return;
          generation++;
          if (phase() === 'playing') phase.set('idle');
        },
        selectLevel(value: LevelId): boolean {
          const level = findLevel(value);
          if (!level) return false;
          selectedLevelId.set(level.id);
          return true;
        },
        rename(value: string): boolean {
          const name = normalizePlayerName(value);
          if (name === null) return false;
          nickname.set(name);
          return true;
        },
      },
    };
  },
});
