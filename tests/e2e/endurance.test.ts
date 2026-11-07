/**
 * 镜川引擎 - 长时间游玩内存泄漏检测
 *
 * 使用 Playwright + Chrome DevTools Protocol (CDP) 模拟长时间游玩场景
 * 检测浏览器端内存泄漏
 *
 * 测试场景：
 * - 10 个关卡连续游玩（简化版，每关 ~30 秒）
 * - 总时长约 5-8 分钟，适合 CI 环境
 * - 采集初始和最终堆内存，计算增长率
 * - 内存增长不应超过初始值的 20%
 */

import { test, expect } from '@playwright/test';
import type { CDPSession } from '@playwright/test';

// 仅在 Chromium 上运行（需要 CDP session）
test.use({ browserName: 'chromium' });

interface PerformanceMetrics {
  metrics: Array<{ name: string; value: number }>;
}

/**
 * 从性能指标中提取 JS 堆大小（字节）
 */
function getJSHeapSize(metrics: PerformanceMetrics): number {
  const heapMetric = metrics.metrics.find(m => m.name === 'JSHeapUsedSize');
  return heapMetric?.value ?? 0;
}

/**
 * 等待游戏应用加载完成
 */
async function waitForGameReady(page: any, timeout = 10000): Promise<void> {
  await page.waitForSelector('game-app', { timeout });

  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const checkReady = () => {
        const gameApp = document.querySelector('game-app');
        if (gameApp && gameApp.children.length > 0) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  });
}

/**
 * 模拟一个关卡的游玩周期
 */
async function playOneLevel(page: any, levelIndex: number): Promise<void> {
  console.log(`  开始游玩关卡 ${levelIndex + 1}/10...`);

  // 尝试点击进入游戏或选择关卡
  const playButton = page.locator('button, a').filter({ hasText: /开始|play|游玩|进入|关卡|level/i }).first();

  if (await playButton.count() > 0) {
    await playButton.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  // 游玩 30 秒（模拟游戏过程）
  await page.waitForTimeout(30000);

  // 尝试查找并点击下一关/继续按钮
  const nextButton = page.locator('button, a').filter({ hasText: /下一关|next|继续|continue|完成|finish/i }).first();

  if (await nextButton.count() > 0) {
    await nextButton.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  } else {
    // 如果没有找到按钮，尝试按 Enter 或刷新页面重新开始
    await page.keyboard.press('Enter').catch(() => {});
  }

  console.log(`  关卡 ${levelIndex + 1}/10 完成`);
}

test.describe('镜川引擎 - 内存泄漏耐久测试', () => {
  test('10 关卡连续游玩内存稳定性', async ({ page, browserName }) => {
    const baseURL = process.env.TEST_URL || 'http://localhost:5173';

    console.log(`\n=== 开始浏览器内存泄漏测试 (${browserName}) ===`);
    console.log(`测试 URL: ${baseURL}`);

    // 导航到游戏
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await waitForGameReady(page);

    // 创建 CDP session（仅 Chromium 支持）
    const session: CDPSession = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    await session.send('HeapProfiler.enable');

    // 采集初始内存基线
    console.log('采集初始内存基线...');
    const initialMetrics = await session.send('Performance.getMetrics') as PerformanceMetrics;
    const initialHeap = getJSHeapSize(initialMetrics);
    console.log(`初始堆大小: ${(initialHeap / 1024 / 1024).toFixed(2)} MB`);

    // 循环 10 个关卡
    const levelCount = 10;
    for (let i = 0; i < levelCount; i++) {
      await playOneLevel(page, i);

      // 每 3 关采集一次中间内存数据
      if ((i + 1) % 3 === 0) {
        const midMetrics = await session.send('Performance.getMetrics') as PerformanceMetrics;
        const midHeap = getJSHeapSize(midMetrics);
        const midGrowth = ((midHeap - initialHeap) / initialHeap * 100).toFixed(1);
        console.log(`  中间检查点 (${i + 1}/${levelCount}): ${(midHeap / 1024 / 1024).toFixed(2)} MB (增长 ${midGrowth}%)`);
      }
    }

    // 触发垃圾回收
    console.log('触发垃圾回收...');
    await session.send('HeapProfiler.collectGarbage').catch(() => {
      console.warn('警告: 无法触发 GC，可能影响测量精度');
    });
    await page.waitForTimeout(1000);

    // 采集最终内存
    console.log('采集最终内存...');
    const finalMetrics = await session.send('Performance.getMetrics') as PerformanceMetrics;
    const finalHeap = getJSHeapSize(finalMetrics);

    // 计算增长率
    const growthBytes = finalHeap - initialHeap;
    const growthRatio = growthBytes / initialHeap;
    const growthPercent = (growthRatio * 100).toFixed(1);

    console.log(`\n=== 测试结果 ===`);
    console.log(`初始堆: ${(initialHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`最终堆: ${(finalHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`堆增长: ${(growthBytes / 1024 / 1024).toFixed(2)} MB (${growthPercent}%)`);

    // 关闭 CDP session
    await session.detach();

    // 断言：内存增长不超过初始值的 20%
    const maxGrowthRatio = 0.20;
    expect(growthRatio).toBeLessThan(maxGrowthRatio);

    if (growthRatio < maxGrowthRatio) {
      console.log(`✅ 内存稳定: 增长 ${growthPercent}% < ${(maxGrowthRatio * 100)}%`);
    } else {
      console.error(`❌ 内存泄漏检测到: 增长 ${growthPercent}% >= ${(maxGrowthRatio * 100)}%`);
    }
  });

  test('单关卡反复游玩内存稳定性', async ({ page, browserName }) => {
    const baseURL = process.env.TEST_URL || 'http://localhost:5173';

    console.log(`\n=== 单关卡反复游玩测试 (${browserName}) ===`);

    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await waitForGameReady(page);

    const session: CDPSession = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    await session.send('HeapProfiler.enable');

    // 进入游戏
    const playButton = page.locator('button, a').filter({ hasText: /开始|play|游玩|进入/i }).first();
    if (await playButton.count() > 0) {
      await playButton.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const initialMetrics = await session.send('Performance.getMetrics') as PerformanceMetrics;
    const initialHeap = getJSHeapSize(initialMetrics);
    console.log(`初始堆大小: ${(initialHeap / 1024 / 1024).toFixed(2)} MB`);

    // 反复游玩同一关卡 5 次
    const repeatCount = 5;
    for (let i = 0; i < repeatCount; i++) {
      console.log(`  第 ${i + 1}/${repeatCount} 次游玩...`);

      // 游玩 15 秒
      await page.waitForTimeout(15000);

      // 重新开始
      const restartButton = page.locator('button, a').filter({ hasText: /重新|restart|再来|重玩/i }).first();
      if (await restartButton.count() > 0) {
        await restartButton.click();
      } else {
        // 尝试刷新页面
        await page.reload();
        await waitForGameReady(page);
        if (await playButton.count() > 0) {
          await playButton.click();
          await page.waitForLoadState('networkidle').catch(() => {});
        }
      }
    }

    await session.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(1000);

    const finalMetrics = await session.send('Performance.getMetrics') as PerformanceMetrics;
    const finalHeap = getJSHeapSize(finalMetrics);
    const growthRatio = (finalHeap - initialHeap) / initialHeap;
    const growthPercent = (growthRatio * 100).toFixed(1);

    console.log(`\n=== 测试结果 ===`);
    console.log(`初始堆: ${(initialHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`最终堆: ${(finalHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`堆增长: ${growthPercent}%`);

    await session.detach();

    // 单关卡反复游玩内存增长应更小（15% 阈值）
    const maxGrowthRatio = 0.15;
    expect(growthRatio).toBeLessThan(maxGrowthRatio);

    if (growthRatio < maxGrowthRatio) {
      console.log(`✅ 内存稳定: 增长 ${growthPercent}% < ${(maxGrowthRatio * 100)}%`);
    }
  });
});
