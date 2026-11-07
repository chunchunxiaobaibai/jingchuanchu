import { defineConfig, devices } from '@playwright/test';

/**
 * 请参阅 https://playwright.dev/docs/test-configuration。
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* 在所有测试中运行测试，如同串行的。删除此选项以启用并行执行 */
  fullyParallel: true,
  /* 失败时停止运行其他测试 */
  forbidOnly: !!process.env.CI,
  /* 在 CI 中视为失败 */
  retries: process.env.CI ? 2 : 0,
  /* 在 CI 中最多并行运行工作进程数 */
  workers: process.env.CI ? 1 : undefined,
  /* 报告程序看https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    ['junit', { outputFile: 'test-results/e2e-results.xml' }],
  ],
  /* 所有测试的共享设置。参见 https://playwright.dev/docs/api/class-testoptions。 */
  use: {
    /* 为每个测试收集跟踪信息当重新运行失败时 */
    trace: 'on-first-retry',
    /* 截屏失败 */
    screenshot: 'only-on-failure',
    /* 记录视频失败 */
    video: 'retain-on-failure',
  },

  /* 配置针对主要浏览器的项目 */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* 针对品牌浏览器的测试 */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* 如果您希望在本地运行时针对此项目对 Web UI 或 API 工作，请运行 Web 服务器 */
  webServer: {
    command: 'npm run dev:browser',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
