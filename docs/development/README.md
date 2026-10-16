# 引擎开发手册

当前通过 [GitHub 源码](https://github.com/chunchunxiaobaibai/jingchuanchu) 和本地构建套件使用 0.4.0，暂不发布 npm。首次使用请从 [源码快速入门](getting-started.md) 开始；仓库上传、Release 附件与 npm 发布是分别进行的操作，见 [GitHub 交付说明](../maintainers/github-delivery.md)。

适用版本：0.4.0（已提供 GitHub Release，未发布 npm）；公共 npm 当前仍为 0.3.0。读者可以是游戏开发者，也可以是在引擎上增加模块的开发者。
引擎、示例和文档按 MIT 授权，许可证原文见分发根目录 `LICENSE`。

## 阅读顺序

1. [快速入门](getting-started.md)：安装分发包，运行并修改第一个 TS 游戏。
2. [ECS 与游戏循环](ecs-and-loop.md)：实体、组件、资源、系统与固定步长。
3. [自定义模块](custom-modules.md)：依赖、服务、事件、清理与错误处理。
4. [浏览器功能接入](browser-features.md)：Canvas、键盘、指针和资源加载。
5. [联网接入](networking.md)：客户端、服务端、协议和游戏规则边界。
6. [API 参考](api-reference.md)：公开类型、方法、参数、返回值和默认行为。
7. [分发与版本维护](distribution.md)：打包、校验、交付及 registry 发布。
8. [常见问题](troubleshooting.md)：安装、类型检查、画布、生命周期与网络问题。

希望自行构建引擎或从源码创建游戏，请阅读 [源码构建指南](build-from-source.md)，其中区分引擎编译、套件打包和游戏网页构建。

维护者另见 [npm 发布手册](../maintainers/npm-publishing.md)。本地分发不需要 npm 账号或发布权限。

新版扩展见 [0.4.0 兼容扩展](extensions-0.4.md)，表单闪屏相关接入见 [渲染更新指南](rendering-updates.md)。
原生 TS 模板的目录、三文件组件、依赖检查与旧项目迁移见 [游戏项目规范](project-structure.md)。

应用套件、自动三文件关联、CSS/Less、生命周期与 create/generate 命令见 [应用开发套件](application-suite.md)。

下一阶段的唯一实施入口是 [SPEC](../../SPEC.md)，按模块细化了响应式、组件、Store、路由、主题与完整 2D 游戏所需能力；执行顺序见 [plan](../../tasks/plan.md)，状态见 [todo](../../tasks/todo.md)。这些是待实现规格，不作为 0.4.0 API 使用说明。

## 当前提供什么

8 个原有引擎包，加可选 app 运行包与 tooling 开发工具包。tooling 作为 devDependency 使用，包含编译器、Less、Vite 和 CLI；不进入核心运行包依赖。
除网络服务端使用 `ws` 外，引擎运行代码没有第三方依赖。开发工具不进入游戏运行包。
主仓库包含引擎、回归测试、分发模板与最小接入示例。具体游戏在独立项目中开发，分发安装器只安装选择的模块及其依赖。

游戏代码只调用公开包入口，不能修改引擎内置文件。角色、得分、关卡、回合等规则放在游戏模块。
引擎目前没有编辑器、完整物理、音频、账号系统、通用同步协议、异步 EngineModule.setup 或单模块动态卸载；已提供精灵动画、基础碰撞及场景 prepare/setup。

## 运行条件

- 制作、构建及服务端示例：Node.js >= 22.12，npm。
- TS 消费项目：TypeScript >= 5.4，声明使用 `NoInfer`；附带模板使用发行时已验证的固定工具版本。
- 浏览器运行：ES2022、Canvas 2D、Pointer Events、requestAnimationFrame；联网另需 WebSocket。
- 包为 ESM，不提供独立 CommonJS 构建。推荐应用 `package.json` 设置 `"type": "module"`。

TS 最低版本依据：[NoInfer 官方说明](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)。

## 分发目录

```text
jingchuanchu-engine-0.4.0/
  README.md              分发安装说明
  LICENSE                MIT 授权
  manifest.json          包版本、依赖、文件名和 SHA-256
  SHA256SUMS             每个安装包的校验值
  install.mjs            按模块/预设安装，自动补齐内部依赖
  packages/              8 个 npm tgz
  docs/development/      本手册
  starters/browser/      可以运行和修改的单机 TS 项目
  examples/              无界面、自定义模块、资源和网络示例
```

不需要克隆整个引擎仓库，也不需要启动“你画我猜”，就能开发自己的游戏。
