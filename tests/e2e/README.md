# 桌面浏览器跨平台测试框架

## 概述

本测试框架使用 Playwright 实现对镜川引擎的跨浏览器自动化测试，覆盖 3 个桌面浏览器引擎：

- **Chromium**（最广泛支持）
- **Firefox**（开源社区）
- **WebKit**（Safari 兼容性）

## 测试场景

框架包含以下完整游戏流程测试：

1. **页面加载和初始化** - 验证游戏应用加载和初始化
2. **首页导航和可交互性** - 测试首页 UI 交互和帧率
3. **关卡选择流程** - 验证关卡选择功能
4. **游玩场景加载** - 测试游戏场景加载和帧率
5. **暂停功能** - 验证游戏暂停和恢复
6. **结算页面** - 测试游戏结算流程
7. **返回首页** - 验证返回首页导航
8. **浏览器兼容性和内存使用** - 检查兼容性和资源使用

## 性能指标采集

测试框架自动采集以下性能数据：

- **页面加载时间** (Page Load Time)
- **First Contentful Paint (FCP)** - 首次内容绘制
- **帧率采样** (Frame Rate) - 运行时帧率
- **内存使用** (Memory Usage) - JavaScript 堆内存

## 快速开始

### 安装依赖

```bash
npm install
npm run test:e2e:install
```

### 运行测试

**运行所有浏览器的所有测试：**
```bash
npm run test:e2e
```

**仅运行特定浏览器：**
```bash
npm run test:e2e:chromium   # 仅 Chromium
npm run test:e2e:firefox    # 仅 Firefox
npm run test:e2e:webkit     # 仅 WebKit
```

**交互式调试模式：**
```bash
npm run test:e2e:ui
```

此命令启动 Playwright Inspector，可以逐步执行测试、查看页面状态和调试。

## 文件结构

```
.
├── tests/e2e/
│   └── browser-matrix.test.ts       # 主测试文件，包含所有测试场景
├── playwright.config.ts             # Playwright 配置文件
├── .github/workflows/
│   └── e2e-desktop.yml              # GitHub Actions CI/CD 工作流
└── package.json                     # npm 脚本和依赖
```

## 配置

### playwright.config.ts

主要配置项：

- **testDir** - 测试文件位置：`./tests/e2e`
- **fullyParallel** - 所有测试并行执行
- **retries** - CI 环境重试 2 次，本地环境不重试
- **workers** - CI 环境单工作进程，本地环境自动
- **reporters** - HTML、JSON 和 JUnit 报告格式

**浏览器配置：**
- Chromium - 使用 Chrome/Edge 设备配置
- Firefox - 使用 Firefox 设备配置
- WebKit - 使用 Safari 设备配置

**Web 服务器配置：**
- URL: `http://localhost:5173`
- 启动命令: `npm run dev:browser`
- 复用已有服务器（本地环境）

### GitHub Actions 工作流

`.github/workflows/e2e-desktop.yml` 配置 CI/CD 流程：

- **触发条件** - 在 `dev`、`main` 和 `feat/0.5.0-production-optimization` 分支上 push 和 PR
- **矩阵构建** - 为 3 个浏览器并行运行测试
- **超时** - 每个浏览器测试 30 分钟
- **报告** - 上传测试结果、视频和日志

## 测试报告

测试完成后会生成以下报告：

```
test-results/
├── e2e-results.json     # 详细的 JSON 格式报告
├── e2e-results.xml      # JUnit XML 格式报告
└── index.html           # 可视化 HTML 报告
```

### 查看 HTML 报告

```bash
npx playwright show-report
```

## 调试

### 启用追踪

Playwright 配置自动在测试失败时启用追踪。查看追踪：

```bash
npx playwright show-trace test-results/trace.zip
```

### 截图和视频

失败的测试自动保存：
- 截图 (`.png`)
- 视频 (`.webm`)

位置：`test-results/videos/` 和 `test-results/screenshots/`

### 调试单个测试

```bash
npx playwright test tests/e2e/browser-matrix.test.ts --headed
```

`--headed` 标志显示浏览器窗口，便于调试。

## 环境变量

- `TEST_URL` - 游戏服务器 URL（默认：`http://localhost:5173`）
- `CI` - 设置为 `true` 时启用 CI 模式（GitHub Actions 自动设置）

## 验收标准

测试按以下标准验证功能：

1. **可用性** - 元素可见且可交互
2. **性能** - 页面加载 < 5 秒，帧率 >= 30 FPS
3. **兼容性** - 在 3 个浏览器上功能一致
4. **资源使用** - 内存使用 < 500 MB

## 常见问题

### Q: 测试卡在"等待游戏加载"

**A:** 确保 `dev:browser` 服务器正在运行，或设置 `TEST_URL` 环境变量指向已运行的服务器。

### Q: 特定浏览器测试失败

**A:** 查看失败浏览器对应的视频和截图（在 `test-results/` 中），使用 `--headed --debug` 标志单独调试。

### Q: 如何跳过某个测试

**A:** 使用 `.skip()`：
```typescript
test.skip('测试名称', async () => {
  // ...
});
```

### Q: 如何只运行某个测试

**A:** 使用 `.only()`：
```typescript
test.only('测试名称', async () => {
  // ...
});
```

## 扩展测试

### 添加新测试场景

编辑 `tests/e2e/browser-matrix.test.ts`，在 `test.describe` 块中添加新的 `test()` 调用：

```typescript
test('新测试场景', async ({ page, browserName }) => {
  // 测试代码
});
```

### 添加设备特定测试

在 `playwright.config.ts` 中的 `projects` 数组中添加新配置。

## 本地开发工作流

1. **启动开发服务器：**
   ```bash
   npm run dev:browser
   ```

2. **在另一个终端启动测试：**
   ```bash
   npm run test:e2e:ui
   ```

3. **在 Inspector 中调试测试场景**

4. **修改代码后测试会自动重新运行**

## 持续集成

GitHub Actions 工作流 `.github/workflows/e2e-desktop.yml`：

1. 在 PR 和 push 到指定分支时自动运行
2. 为 3 个浏览器并行执行测试
3. 失败时保存报告和视频
4. 生成测试摘要报告

## 参考资源

- [Playwright 官方文档](https://playwright.dev)
- [Playwright 测试配置](https://playwright.dev/docs/test-configuration)
- [性能监测 API](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API)
