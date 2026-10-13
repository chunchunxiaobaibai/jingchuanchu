# 引擎开发手册

适用版本：0.3.0。读者可以是游戏开发者，也可以是在引擎上增加模块的开发者。
引擎、示例和文档按 MIT 授权，许可证原文见分发根目录 `LICENSE`。

## 阅读顺序

1. [快速入门](getting-started.md)：安装分发包，运行并修改第一个 TS 游戏。
2. [ECS 与游戏循环](ecs-and-loop.md)：实体、组件、资源、系统与固定步长。
3. [自定义模块](custom-modules.md)：依赖、服务、事件、清理与错误处理。
4. [浏览器功能接入](browser-features.md)：Canvas、键盘、指针和资源加载。
5. [联网接入](networking.md)：客户端、服务端、协议和游戏规则边界。
6. [API 参考](api-reference.md)：公开类型、方法、参数、返回值和默认行为。
7. [分发与版本维护](distribution.md)：打包、校验、交付及可选的 registry 发布。
8. [常见问题](troubleshooting.md)：安装、类型检查、画布、生命周期与网络问题。

## 当前提供什么

8 个按需引用的 ESM 包：ecs、core、browser、renderer-2d、input、assets、net、net-server。
除网络服务端使用 `ws` 外，引擎运行代码没有第三方依赖。开发工具不进入游戏运行包。
完整仓库含两个游戏示例，因此仓库安装包含联网依赖；分发安装器只安装选择的模块及其依赖。

游戏代码只调用公开包入口，不能修改引擎内置文件。角色、得分、关卡、回合等规则放在游戏模块。
引擎目前没有编辑器、完整物理、音频、账号系统、通用同步协议、异步 setup 或单模块动态卸载。

## 运行条件

- 制作、构建及服务端示例：Node.js >= 22.12，npm。
- TS 消费项目：TypeScript >= 5.4，声明使用 `NoInfer`；附带模板使用发行时已验证的固定工具版本。
- 浏览器运行：ES2022、Canvas 2D、Pointer Events、requestAnimationFrame；联网另需 WebSocket。
- 包为 ESM，不提供独立 CommonJS 构建。推荐应用 `package.json` 设置 `"type": "module"`。

TS 最低版本依据：[NoInfer 官方说明](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)。

## 分发目录

```text
jingchuanchu-engine-0.3.0/
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
