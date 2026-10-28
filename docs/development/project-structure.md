# 0.4.0 项目组织与迁移参考

本文仅说明历史 0.4.0 / legacy-v0.4 模板。当前默认的 src/app、pages、game、components、themes 布局及版本化 paths 见 [应用开发总览](application-framework.md)，可照写的代码见 [组件教程](application-components.md)。新模型契约入口为 [SPEC](../../SPEC.md)。

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

新使用者先阅读 [快速入门](getting-started.md) 和 [应用开发总览](application-framework.md)。维护旧根入口的项目继续按 [旧应用套件手册](application-suite.md) 配置本地依赖和构建插件；不要覆盖已有项目文件。

defineView 的 data-* 绑定、静态资源元数据和生命周期保持旧契约。当前已实现的 application 模型使用独立入口、setup、input/output/model 与显式父级注册；新旧对照和逐页迁移见 [迁移说明](application-framework.md#旧项目如何兼容)。配套新 CLI 可用 --profile legacy-v0.4 创建旧浏览器布局，不自动转换旧模板或存档。
