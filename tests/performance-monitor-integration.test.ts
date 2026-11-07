import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import {
  Collider2D,
  detectCollisions,
  collisionModule,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { PerformanceMonitor } from '../packages/app/runtime/performance-monitor.js';

test('PerformanceMonitor 与 ECS 引擎集成测试', () => {
  const engine = new Engine();
  const monitor = new PerformanceMonitor();

  // 创建测试实体
  const entities = [];
  for (let i = 0; i < 10; i++) {
    const e = engine.world.create();
    engine.world.set(e, Position2D, { x: i * 10, y: i * 10 });
    engine.world.set(e, Collider2D, { kind: 'circle', radius: 5 });
    entities.push(e);
  }

  engine.install([
    collisionModule({
      onEnter: () => {
        // 每次碰撞检测返回碰撞对时记录
        const pairs = detectCollisions(engine.world);
        monitor.recordCollisionPair(pairs.length);
      },
    }),
  ]);

  engine.start();

  // 模拟 3 帧游戏循环
  for (let frame = 0; frame < 3; frame++) {
    // 记录查询操作
    monitor.recordQuery();
    for (const e of engine.world.query(Position2D)) {
      monitor.recordQuery();
    }

    // 记录实体数量
    monitor.setEntityCount(engine.world.size);

    // 推进引擎一步
    engine.advance(engine.step);

    // 完成本帧
    const metrics = monitor.finishFrame();

    // 验证指标
    assert.ok(metrics.queries >= 1, '应有至少 1 次查询');
    assert.equal(metrics.entities, 10, '应有 10 个实体');
  }

  engine.dispose();
});

test('PerformanceMonitor 模拟完整游戏帧', () => {
  const engine = new Engine();
  const monitor = new PerformanceMonitor();

  // 创建简单场景
  for (let i = 0; i < 5; i++) {
    const e = engine.world.create();
    engine.world.set(e, Position2D, { x: Math.random() * 100, y: Math.random() * 100 });
  }

  engine.start();

  const frameMetrics = [];

  // 采集 10 帧数据
  for (let f = 0; f < 10; f++) {
    // 模拟 ECS 查询
    const queryCount = 1 + Math.floor(Math.random() * 3);
    for (let q = 0; q < queryCount; q++) {
      for (const e of engine.world.query(Position2D)) {
        (e as unknown); // 消费实体
        monitor.recordQuery();
      }
    }

    // 模拟碰撞检测
    const pairs = detectCollisions(engine.world);
    if (pairs.length > 0) {
      monitor.recordCollisionPair(pairs.length);
    }

    // 模拟渲染
    const drawCallsPerFrame = 3 + Math.floor(Math.random() * 5);
    for (let d = 0; d < drawCallsPerFrame; d++) {
      monitor.recordDrawCall();
    }

    // 设置活跃实体数
    monitor.setEntityCount(engine.world.size);

    // 推进引擎
    engine.advance(engine.step);

    // 获取本帧指标
    const metrics = monitor.finishFrame();
    frameMetrics.push(metrics);
  }

  // 验证数据完整性
  assert.equal(frameMetrics.length, 10, '应采集 10 帧数据');

  // 检查数据合理性
  for (const metrics of frameMetrics) {
    assert.ok(metrics.queries > 0, '每帧应有查询');
    assert.ok(metrics.drawCalls >= 3, '每帧应有至少 3 次 drawCall');
    assert.equal(metrics.entities, 5, '应保持 5 个实体');
    assert.ok(typeof metrics.memory.heap === 'number', '堆内存应为数字');
    assert.ok(typeof metrics.memory.external === 'number', '外部内存应为数字');
  }

  engine.dispose();
});
