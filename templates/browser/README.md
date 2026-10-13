# 从这里开始制作游戏

此示例在分发归档的 `starters/browser` 中可以直接使用：

```bash
npm install
npm run dev
```

访问 http://localhost:5175 。`npm run build` 会先进行严格 TS 检查，再输出静态网页到 `dist`。

- `src/main.ts`：安装引擎功能模块、接入 DOM 输入和页面生命周期。
- `src/game.ts`：自定义游戏模块、实体数据和移动规则。
- `src/style.css`：页面样式。

首先修改 `src/game.ts`，添加自己的组件、实体和系统。无须修改引擎包。
完整手册见分发根目录的 `docs/development/README.md`。本示例不连接游戏服务器。

本仓库的 `templates/browser` 是打包输入；请使用生成后的分发归档，生成过程会把引擎依赖改为对应本地 tgz，并固定开发工具版本。
