# 0.4.0 项目组织与迁移参考

本文仅说明现有 0.4.0 模板，不是下一阶段框架规格。新页面/组件/路由与主题模型以 [SPEC](../../SPEC.md) 为唯一实施入口，任务见 [plan](../../tasks/plan.md)。

## 现有模板

0.4.0 按 app、contracts、game、ui 和 styles 分层。app 组合引擎与平台输入，game 保存场景/数据/系统，ui 保存视图，contracts 保存既有输入/命令/展示类型。此布局继续适用于旧项目；不会因新提案出现就自动迁移。

默认启动路径使用 GameApp/GameControls、defineGame/defineScene/defineView 与 bootstrapGame。组件 TS/HTML/CSS 或 Less 自动关联；旧 GameView/GameHud 的手工 HTML/CSS Modules 写法只是迁移对照，不作为新生成器模板。

```bash
npm install
npm run check
npm run build
npm run dev
```

现有 check 检查项目结构、组件资源/绑定及 TS；build 再执行 Vite。check-project.mjs 的旧目录/依赖规则只适用于该版本项目。新布局实施时使用版本化 profile 和 paths，不能把两种规则同时强加给同一项目。

## 使用和迁移

新使用者先阅读 [应用套件手册](application-suite.md) 和 [快速入门](getting-started.md)。从手工模板迁移时，把界面变更与引擎/玩法改动分开，按该手册配置本地依赖和构建插件；不要覆盖已有项目文件。

现有 defineView 的 data-* 绑定、静态资源元数据和生命周期保持旧契约。未来新组件模型使用独立 application 入口，完成后再提供明确的迁移例；本轮没有把新 API 写成已可用命令。
