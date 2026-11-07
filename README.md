# 镜川初 · Jingchuanchu Engine

面向网页 2D 游戏的 TypeScript 引擎，当前版本 0.5.0，MIT 授权。

完整手册集中在 [HTML 文档站](docs/index.html)：[快速上手](docs/guide/quick-start.html)、[API](docs/api/index.html)、[目录与文件归属](docs/engineering/project-structure.html)。

```bash
npm ci
npm run docs:dev
```

手动访问终端显示的本机地址，或直接打开 docs/index.html。文档以 HTML 编写，独立于引擎和游戏运行时。

packages/ 存放引擎包；templates/ 存放项目模板；examples/ 存放接入示例；scripts/ 存放构建验证工具；tests/ 存放行为测试。实施依据见 SPEC.md 与 tasks/。

0.5.0 在 0.5.0-rc.1 基础上新增：`World.bulkQuery()` 热路径查询优化、`TransformFrameCache` 帧级矩阵缓存、`PerformanceMonitor` 运行时性能采集、调试性能面板（`createPerfPanel`）、Playwright 跨浏览器测试（Chromium / Firefox / WebKit）与 Node 端内存耐久测试（`npm run test:endurance`）。变更详情见 CHANGELOG.md。
