# 0.5.0 发布检查清单

## 自动化验证（已完成）

- ✅ TypeScript 类型检查：0 errors
- ✅ 单元测试：384/384 通过（77.7 秒）
- ✅ 耐久测试（Node）：100 周期，堆增长 2.09 MB < 10 MB 阈值
- ✅ 性能基准：所有热路径数据已保存至 `artifacts/performance/final-0.5.0.json`

## 相对 rc.1 的累计热路径改善（微基准）

| 操作 | 改善幅度 |
| --- | --- |
| 10k 无 token 查询 | 7.7% |
| 10k 单组件查询 | 4.6% |
| 10k 四组件查询 | 3.4% |
| 动作空闲采样 | 6.8% |
| 碰撞稀疏 1k | 16.4% |
| 碰撞同轴 1k | 2.5% |

## 新增公开 API（保留现有 API）

- `World.bulkQuery(...tokens): BulkQueryIterator` — 热路径查询优化
- `PerformanceMonitor` — 运行时性能采集
- `createPerfPanel(options)` — 调试性能面板
- `TransformFrameCache` — 帧级矩阵缓存
- `defineApplication({ debug: { perfPanel: true } })` — 调试面板启用

## 测试基础设施

- Playwright 配置：Chromium、Firefox、WebKit（桌面三平台）
- CI 工作流：`.github/workflows/e2e-desktop.yml`
- Node 端耐久测试：`npm run test:endurance`

## 仍需人工授权

- [ ] H01–H04 浏览器/设备人工验收
- [ ] GitHub Release 创建
- [ ] npm 发布（按 AGENTS.md 不自动执行）
- [ ] 标签 v0.5.0 创建

## 文档

- ✅ CHANGELOG.md 已创建并包含完整变更记录
- ✅ packages/ecs/README.md 已更新 bulkQuery 说明
- ✅ tasks/performance-spec.md 已更新
- ✅ artifacts/performance/iterations/README.md 已记录迭代数据

## 提交清单

本版本包含 6 个功能提交：
1. `39b7f48` feat(ecs): add bulkQuery API for hot-path optimization
2. `645ed6f` test(e2e): add endurance and memory leak detection
3. `62746ba` perf(renderer): add frame-level Transform matrix cache
4. `eee8c83` perf(app): integrate bulkQuery into rendering pipeline
5. `5b1cc6c` feat(app): add debug performance panel UI
6. (本提交) chore: release 0.5.0

所有提交保留 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 标记。

## 已知限制

1. H01–H04 浏览器/设备人工验收未执行，需用户明确授权。
2. 碰撞检测同 X 轴密集分布仍有 O(n²) 扫描上界。
3. WebGL 后端未实现，Canvas 2D 为唯一渲染后端。
4. bulkQuery 实测改善（15–18%）低于最初估算（55%），迭代器协议与修改检测有固定开销。
5. Task 5（性能面板）未实现运行时自动绑定到 GameCanvas 帧末尾，需手动调用 `update()` 或后续集成。

## 完整验证命令

```bash
npm run typecheck          # ✅ 通过
npm run test               # ✅ 384/384
npm run test:endurance     # ✅ 2.09MB 增长
npm run benchmark:hot-paths # ✅ 基准已保存
```
