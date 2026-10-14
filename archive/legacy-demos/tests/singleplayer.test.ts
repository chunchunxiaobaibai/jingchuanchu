import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { keyboardModule } from '@xiaobaibaifqy/jingchuanchu-input/module';
import { Collector, collectorModule, resetCollector } from '../games/singleplayer/index.js';

test('singleplayer logic runs headlessly, collects, clamps and resets without networking', () => {
  const engine = new Engine();
  const target = new EventTarget();
  engine.install([keyboardModule({ target }), collectorModule()]);
  engine.start();
  const state = engine.world.getResource(Collector);
  const position = engine.world.require(state.player, Position2D);
  state.target = { x: 0.2 * state.width + 9, y: 0.25 * state.height + 9 };
  for (let i = 0; i < 120; i++) engine.advance(engine.step);
  assert.equal(state.score, 1);
  assert.equal(engine.world.size, 5);
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ArrowLeft' }));
  for (let i = 0; i < 120; i++) engine.advance(engine.step);
  assert.equal(position.x, 14);
  resetCollector(engine.world);
  assert.equal(state.score, 0);
  assert.equal(engine.world.size, 6);
  engine.dispose();
});
