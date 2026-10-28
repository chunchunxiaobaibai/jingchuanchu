import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import { Sprite2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import { Collider2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { DefaultTheme } from '../templates/browser/src/themes/default/default-theme.js';
import { DuskTheme } from '../templates/browser/src/themes/dusk/dusk-theme.js';
import { createThemedPlayScene } from '../templates/browser/src/pages/play/themed-play-scene.js';
import type { ThemeImageLease, AudioControls } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import type { GameSceneAccess } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { StoreRegistry } from '../packages/app/runtime/store.js';
import { adaptGameScene } from '../packages/app/runtime/game-scene.js';
import { ActionSampler } from '../packages/app/runtime/input-actions.js';
import { GameStore } from '../templates/browser/src/game/session/game-store.js';
import {
  PlayScene,
  playActions,
  Collector,
  Collectible,
  playBounds,
} from '../templates/browser/src/pages/play/play-scene.js';
function fixture(scene = PlayScene, audio?: AudioControls) {
  const engine = new Engine({ tickRate: 10 }),
    scenes = new SceneManager(engine);
  const owner = new ComponentOwner(undefined, {
    stores: new StoreRegistry([], { automatic: true }),
  });
  const game = owner.resolve('stores', GameStore),
    sampler = new ActionSampler(playActions);
  const services: GameSceneAccess & {
    readActions: () => ReturnType<typeof sampler.read>;
    setActive: (active: boolean) => void;
  } = {
    ...(audio ? { audio } : {}),
    assets: {
      load: async () => {
        throw new Error('No assets configured in this scene fixture');
      },
    },
    useStore: (definition) => owner.resolve('stores', definition),
    useTheme: () => {
      throw new Error('No theme configured in this scene fixture');
    },
    readActions: () => sampler.read(),
    setActive: (active) => sampler.setActive(active),
  };
  const start = () => scenes.switchTo(adaptGameScene(scene, { levelId: 'meadow' }, () => services));
  return {
    engine,
    scenes,
    game,
    sampler,
    start,
    dispose() {
      engine.dispose();
      owner.dispose();
    },
  };
}

test('reference scene moves at normalized speed, follows pointer goals, collects through real colliders and freezes when paused', async () => {
  const f = fixture();
  try {
    await f.start();
    assert.equal(f.game.state.phase(), 'idle');
    f.engine.start();
    f.engine.advance(0.1);
    assert.equal(f.game.state.phase(), 'playing');
    const player = [...f.engine.world.query(Collector)][0]!;
    const position = f.engine.world.require(player, Position2D),
      initial = { ...position };
    f.sampler.setVirtual('horizontal', 1);
    f.sampler.setVirtual('vertical', 1);
    f.engine.advance(0.1);
    assert.ok(
      Math.abs(
        Math.hypot(position.x - initial.x, position.y - initial.y) - playBounds.speed * 0.1,
      ) < 1e-8,
    );
    f.sampler.setVirtual('horizontal', 0);
    f.sampler.setVirtual('vertical', 0);
    const first = [...f.engine.world.query(Collectible)][0]!;
    const point = f.engine.world.require(first, Position2D);
    f.sampler.setPointer({ x: point.x + 10, y: point.y + 10, inside: true }, true);
    f.sampler.setPointer({ x: point.x + 10, y: point.y + 10, inside: true }, false);
    f.engine.advance(0.1);
    f.scenes.pause();
    const pausedPosition = { ...position },
      remaining = f.game.state.remainingSeconds();
    for (let i = 0; i < 10; i++) f.engine.advance(0.1);
    assert.deepEqual(position, pausedPosition);
    assert.equal(f.game.state.remainingSeconds(), remaining);
    f.scenes.resume();
    f.engine.advance(0.1);
    assert.deepEqual(position, pausedPosition); // pause cleared the old pointer destination
    assert.ok(f.game.state.remainingSeconds() < remaining);
    while (f.game.state.phase() === 'playing') {
      const item = [...f.engine.world.query(Collectible)][0];
      if (!item) break;
      const target = f.engine.world.require(item, Position2D);
      f.sampler.setPointer({ x: target.x + 10, y: target.y + 10, inside: true }, true);
      f.sampler.setPointer({ x: target.x + 10, y: target.y + 10, inside: true }, false);
      for (
        let steps = 0;
        steps < 100 && f.engine.world.isAlive(item) && f.game.state.phase() === 'playing';
        steps++
      )
        f.engine.advance(0.1);
      assert.equal(f.engine.world.isAlive(item), false);
    }
    assert.equal(f.game.state.outcome(), 'cleared');
    assert.equal(f.game.state.score(), 8);
    assert.ok(f.game.state.remainingSeconds() > 0);
    const finished = f.game.state.remainingSeconds();
    f.engine.advance(0.1);
    assert.equal(f.game.state.remainingSeconds(), finished);
    f.scenes.dispose();
    assert.equal(f.engine.world.size, 0);
    assert.equal(f.engine.getSystems().length, 0);
    assert.equal(f.game.state.outcome(), 'cleared');
  } finally {
    f.dispose();
  }
});

test('timeout and restart use fresh scene clocks/entities without erasing nickname or accepting stale run writes', async () => {
  const f = fixture();
  try {
    f.game.actions.rename('小旅人');
    await f.start();
    f.engine.start();
    for (let step = 0; step < 302 && f.game.state.phase() !== 'finished'; step++)
      f.engine.advance(0.1);
    assert.equal(f.game.state.outcome(), 'timeout');
    assert.equal(f.game.state.remainingSeconds(), 0);
    assert.equal(f.game.state.score(), 0);
    await f.start();
    f.engine.advance(0.1);
    assert.equal(f.game.state.phase(), 'playing');
    assert.equal(f.game.state.outcome(), null);
    assert.equal(f.game.state.nickname(), '小旅人');
    assert.ok(f.game.state.remainingSeconds() > 29);
    assert.equal(f.engine.world.size, 9);
    assert.equal(f.engine.getSystems().length, 2);
    f.scenes.dispose();
    assert.equal(f.game.state.phase(), 'idle');
    assert.equal(f.engine.world.size, 0);
    const old = f.game.actions.beginRun('meadow'),
      current = f.game.actions.beginRun('river');
    assert.equal(f.game.actions.collect(old), false);
    assert.equal(f.game.actions.updateRemaining(old, 0), false);
    f.game.actions.endRun(old);
    assert.equal(f.game.state.phase(), 'playing');
    assert.equal(f.game.state.sessionLevelId(), 'river');
    assert.equal(f.game.actions.collect(current), true);
  } finally {
    f.dispose();
  }
});

test('reference themed sprites use the selected atlas or image without changing collectible colliders or rules', async () => {
  for (const theme of [DefaultTheme, DuskTheme]) {
    const asset = theme.assets['game.collectible'];
    const image = { source: {} as CanvasImageSource, width: 48, height: 24 };
    const lease: ThemeImageLease =
      asset.kind === 'atlas-region'
        ? { kind: 'atlas-region', asset, frame: asset.frame, image, fallback: false, release() {} }
        : { kind: 'image', asset, image, fallback: false, release() {} };
    const f = fixture(createThemedPlayScene(lease, theme.tokens.player));
    try {
      await f.start();
      const items = [...f.engine.world.query(Collectible)];
      assert.equal(items.length, 8);
      for (const item of items) {
        assert.deepEqual(f.engine.world.require(item, Collider2D), {
          kind: 'rect',
          width: 20,
          height: 20,
          group: 2,
          mask: 1,
        });
        const sprite = f.engine.world.require(item, Sprite2D);
        assert.equal(sprite.image, image.source);
        assert.equal(sprite.width, 20);
        assert.equal(sprite.height, 20);
        assert.deepEqual(sprite.frame, asset.kind === 'atlas-region' ? asset.frame : undefined);
      }
      f.engine.start();
      f.engine.advance(0.1);
      const player = [...f.engine.world.query(Collector)][0]!;
      const itemPosition = f.engine.world.require(items[0]!, Position2D);
      Object.assign(f.engine.world.require(player, Position2D), itemPosition);
      f.engine.advance(0.1);
      assert.equal(f.game.state.score(), 1);
      assert.equal(f.engine.world.isAlive(items[0]!), false);
    } finally {
      f.dispose();
    }
  }
});

test('collect feedback pulses on the game clock while keeping collision radius and emits a finish once per run', async () => {
  const asset = DuskTheme.assets['game.collectible'];
  if (asset.kind !== 'image') throw new Error('Expected a whole-image theme fixture');
  const lease: ThemeImageLease = {
    kind: 'image',
    asset,
    image: { source: {} as CanvasImageSource, width: 24, height: 24 },
    fallback: false,
    release() {},
  };
  const audio = {} as AudioControls;
  const events: string[] = [];
  const scene = createThemedPlayScene(lease, DuskTheme.tokens.player, {
    collected(owner, run) {
      assert.equal(owner, audio);
      events.push(`collect:${run}`);
    },
    finished(outcome, run) {
      events.push(`${outcome}:${run}`);
    },
  });
  const f = fixture(scene, audio);
  try {
    await f.start();
    f.engine.start();
    f.engine.advance(0.1);
    const player = [...f.engine.world.query(Collector)][0]!;
    const item = [...f.engine.world.query(Collectible)][0]!;
    Object.assign(
      f.engine.world.require(player, Position2D),
      f.engine.world.require(item, Position2D),
    );
    f.engine.advance(0.1);
    const shape = f.engine.world.require(player, Shape2D);
    assert.ok(shape.width > playBounds.radius * 2);
    assert.deepEqual(f.engine.world.require(player, Collider2D), {
      kind: 'circle',
      radius: 16,
      group: 1,
      mask: 2,
    });
    const width = shape.width;
    f.engine.pause();
    f.scenes.pause();
    f.engine.advance(1);
    assert.equal(shape.width, width);
    f.engine.resume();
    f.scenes.resume();
    f.engine.advance(0.1);
    assert.ok(shape.width < width && shape.width > 32);
    f.engine.advance(0.1);
    assert.equal(shape.width, 32);
    const run = f.game.state.runId();
    assert.deepEqual(events, [`collect:${run}`]);
    f.game.actions.finishRun(run, 'timeout');
    f.engine.advance(0.1);
    f.engine.advance(0.1);
    assert.deepEqual(events, [`collect:${run}`, `timeout:${run}`]);
    await f.start();
    f.engine.advance(0.1);
    const nextPlayer = [...f.engine.world.query(Collector)][0]!;
    for (const item of [...f.engine.world.query(Collectible)]) {
      Object.assign(
        f.engine.world.require(nextPlayer, Position2D),
        f.engine.world.require(item, Position2D),
      );
      f.engine.advance(0.1);
    }
    const nextRun = f.game.state.runId();
    assert.ok(nextRun > run);
    assert.equal(f.game.state.score(), 8);
    assert.equal(f.game.state.outcome(), 'cleared');
    f.engine.advance(0.1);
    assert.equal(events.filter((event) => event === `cleared:${nextRun}`).length, 1);
    assert.equal(events.filter((event) => event === `collect:${nextRun}`).length, 8);
  } finally {
    f.dispose();
  }
});
