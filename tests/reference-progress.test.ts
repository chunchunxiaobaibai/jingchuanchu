import assert from 'node:assert/strict';
import test from 'node:test';
import { SaveService } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { StoreRegistry } from '../packages/app/runtime/store.js';
import { ProgressStore } from '../templates/browser/src/game/progress/progress-store.js';
import { ProgressSave } from '../templates/browser/src/game/progress/progress-save.js';

function fixture() {
  const owner = new ComponentOwner(undefined, {
    stores: new StoreRegistry([], { automatic: true }),
  });
  return { owner, progress: owner.resolve('stores', ProgressStore) };
}

test('level progress keeps high scores and completion across replays and merges older saves atomically', () => {
  const { owner, progress } = fixture(),
    other = fixture();
  try {
    assert.equal(progress.actions.recordResult('meadow', 3, 'timeout'), true);
    assert.equal(progress.actions.recordResult('meadow', 2, 'timeout'), true);
    assert.deepEqual(progress.state.levels().meadow, { bestScore: 3, completed: false });
    assert.equal(progress.actions.recordResult('meadow', 8, 'cleared'), true);
    assert.equal(progress.actions.recordResult('meadow', 0, 'timeout'), true);
    progress.actions.restore({
      meadow: { bestScore: 1, completed: false },
      river: { bestScore: 4, completed: false },
    });
    assert.deepEqual(progress.state.levels(), {
      meadow: { bestScore: 8, completed: true },
      river: { bestScore: 4, completed: false },
    });
    const before = progress.state.levels();
    assert.equal(progress.actions.recordResult('river', 3, 'cleared'), false);
    assert.equal(progress.actions.recordResult('river', 13, 'timeout'), false);
    assert.equal(progress.actions.recordResult('river', NaN, 'timeout'), false);
    assert.equal(progress.actions.recordResult('river', 1.5, 'timeout'), false);
    assert.throws(() =>
      progress.actions.restore({
        night: { bestScore: 2, completed: false },
        river: { bestScore: -1, completed: false },
      }),
    );
    assert.throws(() => progress.actions.restore({ unknown: { bestScore: 0, completed: false } }));
    assert.equal(progress.state.levels(), before);
    assert.deepEqual(other.progress.state.levels(), {});
  } finally {
    owner.dispose();
    other.owner.dispose();
  }
});

test('progress persistence uses only versioned level records and preserves corrupt or incompatible saves', async () => {
  const { owner, progress } = fixture(),
    other = fixture();
  const records = new Map<string, string>();
  const storage = new SaveService({
    storage: {
      async get(key) {
        return records.get(key) ?? null;
      },
      async set(key, value) {
        records.set(key, value);
      },
      async remove(key) {
        records.delete(key);
      },
    },
  });
  try {
    progress.actions.recordResult('meadow', 8, 'cleared');
    progress.actions.recordResult('river', 2, 'timeout');
    assert.equal((await storage.save(ProgressSave, progress)).status, 'saved');
    const [key, raw] = [...records][0]!;
    assert.deepEqual(JSON.parse(raw), {
      schemaVersion: 1,
      data: {
        meadow: { bestScore: 8, completed: true },
        river: { bestScore: 2, completed: false },
      },
    });
    // A record finishing after load began must survive the eventual restore.
    const loaded = await storage.load(ProgressSave);
    other.progress.actions.recordResult('river', 12, 'cleared');
    assert.equal(loaded.status, 'loaded');
    if (loaded.status !== 'loaded') throw new Error('Expected loaded progress');
    ProgressSave.restore(other.progress, loaded.data);
    assert.deepEqual(other.progress.state.levels(), {
      meadow: { bestScore: 8, completed: true },
      river: { bestScore: 12, completed: true },
    });
    const before = other.progress.state.levels();
    for (const [rawRecord, expected] of [
      ['broken', 'corrupt'],
      [JSON.stringify({ schemaVersion: 2, data: {} }), 'incompatible'],
      [
        JSON.stringify({ schemaVersion: 1, data: { night: { bestScore: 50, completed: true } } }),
        'corrupt',
      ],
    ]) {
      records.set(key, rawRecord!);
      assert.equal((await storage.load(ProgressSave)).status, expected);
      assert.equal(records.get(key), rawRecord);
      assert.equal(other.progress.state.levels(), before);
    }
  } finally {
    owner.dispose();
    other.owner.dispose();
  }
});
