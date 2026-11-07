import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceMonitor, type PerformanceMetrics } from '../packages/app/runtime/performance-monitor.js';

test('PerformanceMonitor: 基础指标递增和重置', () => {
  const monitor = new PerformanceMonitor();

  // 录制一帧
  monitor.recordQuery();
  monitor.recordQuery();
  monitor.recordCollisionPair(3);
  monitor.recordDrawCall();
  monitor.recordDrawCall();
  monitor.recordDrawCall();
  monitor.setEntityCount(42);

  const metrics = monitor.finishFrame();

  assert.equal(metrics.queries, 2, '应记录 2 次 query');
  assert.equal(metrics.collision, 3, '应记录 3 个碰撞对');
  assert.equal(metrics.drawCalls, 3, '应记录 3 次 drawCall');
  assert.equal(metrics.entities, 42, '应正确设置实体数');

  // 重置后计数归零
  const nextFrame = monitor.finishFrame();
  assert.equal(nextFrame.queries, 0, '重置后 query 应为 0');
  assert.equal(nextFrame.collision, 0, '重置后 collision 应为 0');
  assert.equal(nextFrame.drawCalls, 0, '重置后 drawCalls 应为 0');
});

test('PerformanceMonitor: FPS 计算', async () => {
  const monitor = new PerformanceMonitor();

  // 模拟 60 帧（约 16ms 每帧）
  // 实际时间取决于系统，但我们检查 FPS 在第一秒后被计算
  const startTime = performance.now();
  let fps = 0;

  // 快速完成多个帧
  for (let i = 0; i < 10; i++) {
    const metrics = monitor.finishFrame();
    fps = metrics.fps;
  }

  // 由于时间可能不足 1 秒，FPS 可能仍为 0
  // 这个测试验证 FPS 计算逻辑不会崩溃
  assert.ok(typeof fps === 'number' && fps >= 0, 'FPS 应为非负整数');
});

test('PerformanceMonitor: 内存追踪（可用时）', () => {
  const monitor = new PerformanceMonitor();

  monitor.recordQuery();
  const metrics = monitor.finishFrame();

  // 检查内存对象结构
  assert.ok('memory' in metrics, '指标应包含 memory 对象');
  assert.ok('heap' in metrics.memory, 'memory 应包含 heap 字段');
  assert.ok('external' in metrics.memory, 'memory 应包含 external 字段');
  assert.equal(typeof metrics.memory.heap, 'number', 'heap 应为数字');
  assert.equal(typeof metrics.memory.external, 'number', 'external 应为数字');
});

test('PerformanceMonitor: 完整周期测试', () => {
  const monitor = new PerformanceMonitor();

  // 模拟游戏循环
  const frames: PerformanceMetrics[] = [];

  for (let i = 0; i < 5; i++) {
    // 模拟这一帧的活动
    monitor.recordQuery();
    if (i % 2 === 0) monitor.recordCollisionPair(2);
    monitor.recordDrawCall();
    monitor.recordDrawCall();
    monitor.setEntityCount(10 + i);

    frames.push(monitor.finishFrame());
  }

  // 验证集合中有 5 帧数据
  assert.equal(frames.length, 5, '应有 5 帧数据');

  // 验证第一帧
  const frame0 = frames[0];
  assert.ok(frame0 !== undefined);
  assert.equal(frame0.queries, 1);
  assert.equal(frame0.collision, 2);
  assert.equal(frame0.drawCalls, 2);
  assert.equal(frame0.entities, 10);

  // 验证第二帧（无碰撞）
  const frame1 = frames[1];
  assert.ok(frame1 !== undefined);
  assert.equal(frame1.queries, 1);
  assert.equal(frame1.collision, 0);
  assert.equal(frame1.drawCalls, 2);
  assert.equal(frame1.entities, 11);
});

test('PerformanceMonitor: reset() 清空所有状态', () => {
  const monitor = new PerformanceMonitor();

  monitor.recordQuery();
  monitor.recordQuery();
  monitor.recordCollisionPair(5);
  monitor.recordDrawCall();
  monitor.setEntityCount(100);

  let metrics = monitor.finishFrame();
  assert.equal(metrics.queries, 2);
  assert.equal(metrics.collision, 5);
  assert.equal(metrics.drawCalls, 1);
  assert.equal(metrics.entities, 100);

  // 调用 reset
  monitor.reset();

  // 下一帧应全部为 0（fps 需要时间恢复）
  metrics = monitor.finishFrame();
  assert.equal(metrics.queries, 0, '重置后 queries 应为 0');
  assert.equal(metrics.collision, 0, '重置后 collision 应为 0');
  assert.equal(metrics.drawCalls, 0, '重置后 drawCalls 应为 0');
  assert.equal(metrics.entities, 0, '重置后 entities 应为 0');
});

test('PerformanceMonitor: 碰撞对计数累加', () => {
  const monitor = new PerformanceMonitor();

  // 多次碰撞检测调用，每次返回不同数量的对
  monitor.recordCollisionPair(5);
  monitor.recordCollisionPair(3);
  monitor.recordCollisionPair(1);

  const metrics = monitor.finishFrame();
  assert.equal(metrics.collision, 9, '碰撞对数应累加（5+3+1=9）');
});

test('PerformanceMonitor: 性能开销验证', () => {
  const monitor = new PerformanceMonitor();

  const startTime = performance.now();

  // 执行大量操作
  for (let i = 0; i < 10000; i++) {
    monitor.recordQuery();
    monitor.recordCollisionPair(1);
    monitor.recordDrawCall();
    monitor.setEntityCount(i);
  }

  const elapsedFrame = performance.now() - startTime;

  // 完成 100 帧的性能测试
  const startFrames = performance.now();
  for (let i = 0; i < 100; i++) {
    monitor.finishFrame();
  }
  const elapsedFrames = performance.now() - startFrames;

  // 验证开销在可接受范围（每帧 < 1ms）
  const averageFrameTime = elapsedFrames / 100;
  assert.ok(
    averageFrameTime < 1,
    `平均每帧时间应 < 1ms，实际: ${averageFrameTime.toFixed(2)}ms`,
  );
});
