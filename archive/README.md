# 历史归档

2026-10-14 将完整游戏与历史开发记录从引擎主仓库拆出。保留内容便于回看和继续开发，不作为主仓库构建、测试或 npm 发布的输入。

| 目录 | 内容 |
| --- | --- |
| legacy-demos | 你画我猜、拾光，页面、服务、专用单元/浏览器测试及配置 |
| history | 原 README、根 package/lock/TS 配置、初版架构、历史验证与任务记录 |
| artifacts | 整理前的 dist 与测试产物，仅本地保存，Git 忽略 |

`history` 是原始快照，路径和命令反映归档前状态；请使用当前根 README 维护引擎。原始 0.3.0 发行版还可从 Git 标签 `v0.3.0` 重现。

历史游戏使用独立 package.json，依赖已发布的引擎 **0.3.0**，没有纳入根 workspaces：

```bash
cd archive/legacy-demos
npm install
npm run dev
```

联机网页为 http://localhost:5173 ，房间服务默认 3001；单机入口为 `/singleplayer/`。只启动单机：`npm run dev:singleplayer`，访问 http://localhost:5174 。

独立验证：`npm run build`、`npm test`；安装 Chromium 后可运行 `npm run test:e2e`。Linux 仍需浏览器运行库。本目录不会自动跟随后续引擎版本更新，升级时需要重新验证游戏。

示例仍采用 MIT，许可证见仓库根目录 `LICENSE`。它们是历史功能参考，当前引擎接入示例请使用根目录的 `examples/` 与 `templates/`。
