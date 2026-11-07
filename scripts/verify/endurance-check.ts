/**
 * Node 端内存泄漏检测
 *
 * 通过重复创建和销毁 Engine 来检测 Scope/World 是否正确清理
 * 100 个 Engine 生命周期，堆增长应小于 10MB
 */

import { Engine, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';

// 测试用组件
const PositionToken = component<{ x: number; y: number }>('Position');
const VelocityToken = component<{ vx: number; vy: number }>('Velocity');

/**
 * 模拟一个游戏帧周期
 */
function simulateGameCycle(world: World, iterations: number): void {
  // 创建实体
  const entities: any[] = [];
  for (let i = 0; i < iterations; i++) {
    const entity = world.create();
    world.set(entity, PositionToken, { x: Math.random() * 100, y: Math.random() * 100 });
    world.set(entity, VelocityToken, { vx: Math.random() * 10, vy: Math.random() * 10 });
    entities.push(entity);
  }

  // 查询实体
  for (const entity of world.query(PositionToken, VelocityToken)) {
    const pos = world.get(entity, PositionToken);
    const vel = world.get(entity, VelocityToken);
    if (pos && vel) {
      world.set(entity, PositionToken, { x: pos.x + vel.vx, y: pos.y + vel.vy });
    }
  }

  // 删除一半实体
  for (let i = 0; i < entities.length; i += 2) {
    world.destroy(entities[i]);
  }

  // 清空剩余实体
  for (let i = 1; i < entities.length; i += 2) {
    world.destroy(entities[i]);
  }
}

/**
 * 运行耐久测试
 */
async function runEnduranceCheck(cycles = 100, entitiesPerCycle = 1000): Promise<void> {
  console.log(`开始内存泄漏检测: ${cycles} 个周期，每周期 ${entitiesPerCycle} 个实体`);

  // 预热：执行一次完整周期让 JIT 编译器优化
  {
    const scope = new Scope();
    const world = new World();
    simulateGameCycle(world, 100);
    world.dispose();
    scope.dispose();
  }

  // 强制 GC（如果可用）
  if (global.gc) {
    global.gc();
    console.log('强制 GC 已执行');
  } else {
    console.log('警告: 未启用 --expose-gc，GC 测量可能不准确');
  }

  // 等待 GC 稳定
  await new Promise(r => setTimeout(r, 200));

  const startMem = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  // 主测试循环
  for (let i = 0; i < cycles; i++) {
    const scope = new Scope();
    const world = new World();

    // 模拟游戏帧：创建实体、查询、删除
    simulateGameCycle(world, entitiesPerCycle);

    // 清理
    world.dispose();
    scope.dispose();

    // 每 10 个周期输出进度
    if ((i + 1) % 10 === 0) {
      const currentMem = process.memoryUsage().heapUsed;
      const growthMB = (currentMem - startMem) / 1024 / 1024;
      process.stdout.write(`\r进度: ${i + 1}/${cycles} 周期, 当前堆增长: ${growthMB.toFixed(2)} MB`);
    }
  }

  console.log(''); // 换行

  // 强制 GC（若可用）
  if (global.gc) {
    global.gc();
    await new Promise(r => setTimeout(r, 200));
  }

  const endMem = process.memoryUsage().heapUsed;
  const endTime = performance.now();
  const growthMB = (endMem - startMem) / 1024 / 1024;
  const durationSec = (endTime - startTime) / 1000;

  console.log(`\n=== 测试结果 ===`);
  console.log(`周期数: ${cycles}`);
  console.log(`总耗时: ${durationSec.toFixed(2)} 秒`);
  console.log(`初始堆: ${(startMem / 1024 / 1024).toFixed(2)} MB`);
  console.log(`最终堆: ${(endMem / 1024 / 1024).toFixed(2)} MB`);
  console.log(`堆增长: ${growthMB.toFixed(2)} MB`);

  // 判断是否通过
  const threshold = 10; // 10MB 阈值
  if (growthMB > threshold) {
    console.error(`\n❌ 内存泄漏检测失败: 堆增长 ${growthMB.toFixed(2)} MB 超过阈值 ${threshold} MB`);
    process.exit(1);
  } else {
    console.log(`\n✅ 内存稳定: 堆增长 ${growthMB.toFixed(2)} MB 在可接受范围内 (< ${threshold} MB)`);
  }
}

// 执行测试
runEnduranceCheck().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
