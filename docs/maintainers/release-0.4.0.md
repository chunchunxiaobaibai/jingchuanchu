# 镜川初 0.4.0：应用套件与项目脚手架

本版本通过 GitHub 分发预构建套件，不发布 npm 0.4.0。无需克隆或构建引擎；需要 Node.js >=22.12 和 npm，安装开发依赖仍需网络或已缓存依赖。

## 下载和开始开发

在本 Release 的 Assets 下载 `jingchuanchu-engine-0.4.0.zip`（Windows 方便解压）或 `jingchuanchu-engine-0.4.0.tar.gz`。二者内容一致，包含 10 个本地 tgz、校验清单、安装器、浏览器模板和开发手册。不要把 GitHub 自动生成的 Source code 压缩包当成预构建套件。

解压后保留 packages 与 starters 的相对位置，运行：

```bash
cd jingchuanchu-engine-0.4.0/starters/browser
npm install
npm run dev
```

访问 http://localhost:5175 。开始制作自己的游戏：

```bash
npm run generate -- view score-panel
npm run generate -- scene menu
npm run build
```

生成结果自动注册到模板或 scenes；游戏构建产物在 starters/browser/dist。独立迁移项目、CSS/Less 选择和四类预设见解压目录中的 docs/development/application-suite.md。不要删除项目依赖引用的 packages 中的 tgz；独立移动项目时按手册复制所需包到 vendor 并更新依赖。

## 本次新增

- 可选 app 运行包：类型化应用、场景、输入、命令及只读展示状态。
- 组件实例隔离、父子输入、声明式文本/属性/事件绑定和八个生命周期钩子。
- tooling 开发工具：三文件自动关联、CSS/Less 样式与动画隔离、资源及绑定诊断。
- create/generate/check CLI：core、singleplayer、client、server 预设，组件和场景自动接入。
- 修复场景取消等待挂起及多阶段销毁异常丢失，保留既有核心公开入口。

## 兼容与验证范围

保留 0.3.0 的包名、公开入口和原有函数名；旧项目可继续使用手动组装方式。新 app 需要 0.4.0 配套模块，不应与 0.3.0 混用；公开名称保留不等于所有旧游戏行为均已验证。

已完成严格类型检查、应用套件针对性测试、核心/场景/模块回归、公开名称兼容检查，以及四类预设和 CSS/Less 的独立静态构建。没有运行真实浏览器交互或截图验证；组件配套文件在开发服务中的更新采用整页重载。

附件的 SHA-256 在对应 `.sha256` 文件中；套件内 manifest.json、SHA256SUMS 记录每个 tgz 的校验值和来源提交。
