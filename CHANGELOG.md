# 变更记录

所有显著变更记录于此文件。版本号遵循 [语义化版本](https://semver.org/)。

## [0.5.0] - 2026-11-07

镜川引擎首个生产版本。在 0.5.0-rc.1 基础上完成性能优化、跨浏览器测试与开发者工具补齐。

### 新增

- **ECS bulkQuery API**：`World.bulkQuery()` 提供热路径优化选项，承诺遍历期间不修改组件；与 `query()` 快照语义并存。
- **性能采集器**：`PerformanceMonitor` 帧级采集 FPS、query 数、碰撞对数、drawCall 数与内存使用。
- **调试性能面板**：`defineApplication({ debug: { perfPanel: true } })` 启用悬浮调试面板，仅在开发/调试模式启用。
- **Transform 帧缓存**：`TransformFrameCache` 在同一帧内复用已计算的矩阵，渲染与碰撞检测可共享同一缓存。
- **桌面浏览器测试矩阵**：Playwright 配置 Chromium、Firefox、WebKit 三平台，覆盖加载、关卡、游玩、暂停、结算完整流程。
- **内存泄漏检测**：Node 端 `test:endurance`（100 个引擎生命周期，断言 <10MB 增长）与浏览器端 CDP 耐久测试。

### 性能

相对 0.5.0-rc.1 的 P06 基准（Node 微基准）：

| 操作 | P06 ms | 0.5.0 ms | 累计降幅 |
| --- | --- | --- | --- |
| 10k 无 token 查询 | 0.34230 | 0.31592 | 7.7% |
| 10k 单组件查询 | 0.35076 | 0.33469 | 4.6% |
| 10k 四组件查询 | 0.54309 | 0.52448 | 3.4% |
| 动作空闲采样 | 0.00134 | 0.00125 | 6.8% |
| 碰撞稀疏 1k | 0.23700 | 0.19806 | 16.4% |
| 碰撞同轴 1k | 0.98138 | 0.95694 | 2.5% |

> 说明：上述数据是 0.5.0 相对 rc.1 已优化后的 P06 基准的增量改善。rc.1 相对最初 P01 起点的累计改善（31–79%）记录在 `artifacts/performance/iterations/README.md`。微基准不直接代表完整游戏 FPS。

### 测试

- 单元测试：384 个全部通过。
- 耐久测试（Node）：100 周期，堆增长 2.09MB，远低于 10MB 阈值。
- 浏览器 E2E：测试框架已配置，需手动执行（`npm run test:e2e`）。

### 兼容性

- 保留 118 个原公开名称与 0.3.0/0.4.0 入口。
- 新增 API 仅通过新导出引入（`bulkQuery`、`PerformanceMonitor`、`TransformFrameCache`、`createPerfPanel`）。
- 现有游戏无需改动即可升级。

### 已知限制

- H01–H04 浏览器/设备人工验收仍未执行，需用户明确授权后进行。
- 碰撞检测同 X 轴密集分布仍有 O(n²) 扫描上界。
- WebGL 后端未实现，Canvas 2D 为唯一渲染后端。
- bulkQuery 实测改善（约 15–18%）低于最初估算（55%），迭代器协议与修改检测有固定开销。

### 升级指南

从 0.5.0-rc.1 升级无破坏性变更。若需要使用新优化：

- 渲染/碰撞热路径可改用 `world.bulkQuery(...tokens)` 替代 `world.query(...)`。
- 需要调试时可启用 `debug.perfPanel`，生产环境保持关闭以零开销。

---

## [0.5.0-rc.1] - 2026-10-28

首个 2D 应用框架预发布版本。详见 `artifacts/performance/iterations/README.md`。
