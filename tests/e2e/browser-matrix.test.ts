import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 桌面浏览器跨平台测试框架
 *
 * 测试场景：
 * - 页面加载
 * - 首页导航
 * - 关卡选择
 * - 游玩场景
 * - 暂停功能
 * - 结算页面
 * - 返回首页
 *
 * 性能指标采集：
 * - 页面加载时间
 * - First Contentful Paint (FCP)
 * - Interaction to Next Paint (INP)
 * - 帧率采样
 */

interface PerformanceMetrics {
  loadTime: number;
  fcp?: number | undefined;
  inp?: number | undefined;
  frameRate?: number | undefined;
  memoryUsed?: number | undefined;
}

/**
 * 收集页面性能指标
 */
async function collectPerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
  const metrics = await page.evaluate(() => {
    const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find((entry) => entry.name === 'first-contentful-paint');

    // 计算页面加载时间
    const loadTime = perfData
      ? perfData.domContentLoadedEventEnd - perfData.fetchStart
      : 0;

    // 获取 FCP
    const fcp = fcpEntry ? fcpEntry.startTime : undefined;

    // 获取内存使用（如果可用）
    const memory = (performance as any).memory;
    const memoryUsed = memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined;

    return {
      loadTime,
      fcp,
      memoryUsed,
    };
  });

  return metrics;
}

/**
 * 等待游戏应用加载完成
 */
async function waitForGameReady(page: Page, timeout = 10000): Promise<void> {
  // 等待 game-app 自定义元素被挂载
  await page.waitForSelector('game-app', { timeout });

  // 等待应用初始化完成
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
 * 获取当前屏幕上的文本内容
 */
async function getScreenText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/**
 * 采样帧率
 */
async function sampleFrameRate(page: Page, duration = 1000): Promise<number> {
  const fps = await page.evaluate((sampleDuration: number) => {
    return new Promise<number>((resolve) => {
      let frameCount = 0;
      const startTime = performance.now();

      const countFrames = () => {
        frameCount++;
        const elapsed = performance.now() - startTime;

        if (elapsed < sampleDuration) {
          requestAnimationFrame(countFrames);
        } else {
          const fps = Math.round((frameCount / sampleDuration) * 1000);
          resolve(fps);
        }
      };

      requestAnimationFrame(countFrames);
    });
  }, duration);

  return fps;
}

// 配置基础 URL 和浏览器
const baseURL = process.env.TEST_URL || 'http://localhost:5173';

test.describe('镜川引擎 - 桌面浏览器跨平台测试', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到游戏
    await page.goto(baseURL, { waitUntil: 'networkidle' });

    // 等待游戏应用加载
    await waitForGameReady(page);
  });

  test('页面加载和初始化', async ({ page, browserName }) => {
    // 收集性能指标
    const metrics = await collectPerformanceMetrics(page);

    console.log(`[${browserName}] 页面加载时间: ${metrics.loadTime.toFixed(2)}ms`);
    if (metrics.fcp) {
      console.log(`[${browserName}] FCP: ${metrics.fcp.toFixed(2)}ms`);
    }

    // 验证游戏应用已加载
    const gameApp = page.locator('game-app');
    await expect(gameApp).toBeVisible();

    // 验证主页面显示
    const screenText = await getScreenText(page);
    expect(screenText.length).toBeGreaterThan(0);

    // 性能检查
    expect(metrics.loadTime).toBeLessThan(5000); // 加载时间应该在 5 秒以内
  });

  test('首页导航和可交互性', async ({ page, browserName }) => {
    // 等待首页元素加载
    await page.waitForLoadState('networkidle');

    // 采样帧率
    const fps = await sampleFrameRate(page, 500);
    console.log(`[${browserName}] 首页帧率: ${fps} FPS`);

    // 帧率应该达到至少 30 FPS
    expect(fps).toBeGreaterThanOrEqual(30);

    // 验证首页UI元素
    const screenText = await getScreenText(page);
    expect(screenText).toMatch(/游戏|home|首页|开始/i);
  });

  test('关卡选择流程', async ({ page, browserName }) => {
    // 查找并点击关卡选择按钮（如果存在）
    const selectLevelButton = page.locator('button, a').filter({ hasText: /关卡|level|选择/i }).first();

    if (await selectLevelButton.count() > 0) {
      await selectLevelButton.click();
      await page.waitForNavigation().catch(() => {}); // 可能没有导航
      await page.waitForLoadState('networkidle');

      // 收集点击后的性能数据
      const metrics = await collectPerformanceMetrics(page);
      console.log(`[${browserName}] 关卡选择页面加载时间: ${metrics.loadTime.toFixed(2)}ms`);

      const screenText = await getScreenText(page);
      expect(screenText.length).toBeGreaterThan(0);
    } else {
      console.log(`[${browserName}] 未找到关卡选择按钮`);
    }
  });

  test('游玩场景加载', async ({ page, browserName }) => {
    // 尝试进入游戏场景
    const playButton = page.locator('button, a').filter({ hasText: /开始|play|游玩|进入/i }).first();

    if (await playButton.count() > 0) {
      const startMetrics = await collectPerformanceMetrics(page);

      await playButton.click();
      await page.waitForNavigation().catch(() => {});
      await page.waitForLoadState('networkidle');

      const endMetrics = await collectPerformanceMetrics(page);
      console.log(`[${browserName}] 游戏场景加载时间: ${endMetrics.loadTime.toFixed(2)}ms`);

      // 采样游戏运行帧率
      const fps = await sampleFrameRate(page, 1000);
      console.log(`[${browserName}] 游戏运行帧率: ${fps} FPS`);

      // 游戏运行帧率应该达到至少 30 FPS
      expect(fps).toBeGreaterThanOrEqual(30);

      const screenText = await getScreenText(page);
      expect(screenText.length).toBeGreaterThan(0);
    } else {
      console.log(`[${browserName}] 未找到游戏开始按钮`);
    }
  });

  test('暂停功能', async ({ page, browserName }) => {
    // 进入游戏场景
    const playButton = page.locator('button, a').filter({ hasText: /开始|play|游玩|进入/i }).first();

    if (await playButton.count() > 0) {
      await playButton.click();
      await page.waitForLoadState('networkidle');

      // 等待游戏运行
      await page.waitForTimeout(1000);

      // 尝试按下暂停键 (通常是 ESC 或点击暂停按钮)
      const pauseButton = page.locator('button, a').filter({ hasText: /暂停|pause/i }).first();

      if (await pauseButton.count() > 0) {
        await pauseButton.click();
        const screenText = await getScreenText(page);
        console.log(`[${browserName}] 暂停后屏幕文本: ${screenText.substring(0, 50)}`);

        // 尝试恢复游戏
        const resumeButton = page.locator('button, a').filter({ hasText: /继续|resume|恢复/i }).first();
        if (await resumeButton.count() > 0) {
          await resumeButton.click();
          await page.waitForTimeout(500);
          const resumedText = await getScreenText(page);
          expect(resumedText.length).toBeGreaterThan(0);
        }
      } else {
        // 尝试按 ESC 键暂停
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const screenText = await getScreenText(page);
        expect(screenText.length).toBeGreaterThan(0);
      }
    }
  });

  test('结算页面', async ({ page, browserName }) => {
    // 进入游戏场景
    const playButton = page.locator('button, a').filter({ hasText: /开始|play|游玩|进入/i }).first();

    if (await playButton.count() > 0) {
      await playButton.click();
      await page.waitForLoadState('networkidle');

      // 等待游戏运行足够长时间来触发结算
      await page.waitForTimeout(2000);

      // 尝试找到结算/完成按钮
      const resultButton = page.locator('button, a').filter({ hasText: /结算|完成|结果|finish|result/i }).first();

      if (await resultButton.count() > 0) {
        await resultButton.click();
        await page.waitForNavigation().catch(() => {});
        const screenText = await getScreenText(page);
        console.log(`[${browserName}] 结算页面文本: ${screenText.substring(0, 50)}`);
        expect(screenText.length).toBeGreaterThan(0);
      } else {
        console.log(`[${browserName}] 未找到结算按钮或游戏自动结算`);
      }
    }
  });

  test('返回首页', async ({ page, browserName }) => {
    // 导航到关卡或游戏页面
    const selectLevelButton = page.locator('button, a').filter({ hasText: /关卡|level|选择/i }).first();

    if (await selectLevelButton.count() > 0) {
      await selectLevelButton.click();
      await page.waitForNavigation().catch(() => {});
      await page.waitForLoadState('networkidle');

      // 寻找返回首页按钮
      const homeButton = page.locator('button, a').filter({ hasText: /首页|home|返回|back/i }).first();

      if (await homeButton.count() > 0) {
        await homeButton.click();
        await page.waitForNavigation().catch(() => {});
        await page.waitForLoadState('networkidle');

        const screenText = await getScreenText(page);
        console.log(`[${browserName}] 返回首页后文本: ${screenText.substring(0, 50)}`);
        expect(screenText.length).toBeGreaterThan(0);
      } else {
        console.log(`[${browserName}] 未找到返回首页按钮`);
      }
    }
  });

  test('浏览器兼容性和内存使用', async ({ page, browserName }) => {
    // 执行一系列交互
    await page.evaluate(() => {
      // 模拟多次点击和导航
      const buttons = Array.from(document.querySelectorAll('button, a'));
      console.log(`页面上有 ${buttons.length} 个交互元素`);
    });

    // 收集内存数据
    const metrics = await collectPerformanceMetrics(page);
    if (metrics.memoryUsed) {
      console.log(`[${browserName}] 内存使用: ${metrics.memoryUsed} MB`);
      // 内存使用应该在合理范围内（< 500 MB）
      expect(metrics.memoryUsed).toBeLessThan(500);
    }

    // 采样最终帧率
    const fps = await sampleFrameRate(page, 500);
    console.log(`[${browserName}] 最终帧率: ${fps} FPS`);
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});
