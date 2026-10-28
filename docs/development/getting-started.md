# 快速入门：创建第一个网页 2D 游戏

使用包含 app/application 的当前源码或由它构建的配套套件。历史 v0.4.0 附件保留旧行为；同版本号不是新能力的证明。已有旧项目继续使用 [旧应用套件手册](application-suite.md)，显式迁移见 [应用总览](application-framework.md)。

## 从源码创建

准备 Node.js >=22.12.0、npm、tar。在已有当前源码的引擎根目录运行；安装依赖与构建在同一个操作系统环境完成：

```bash
npm ci
npm run dist:release
node packages/tooling/dist/cli.mjs create ../my-game --preset singleplayer --style css --bundle ./dist/releases/jingchuanchu-engine-0.5.0-rc.1
cd ../my-game
npm install
npm run check
npm run build
npm run dev
```

访问终端显示的 Vite 地址。当前新模板未固定 dev/preview 端口；需要固定端口时执行 `npm run dev -- --port 5175 --strictPort`。引擎根目录没有 dev，后续开发命令都在 my-game 内执行。

create 的目标应为空目录。引擎包从套件复制到 vendor，依赖使用相对 file 路径；Vite/TypeScript 等开发依赖由 npm 下载或使用缓存。无需 npm 登录，构建也不自动发布。需要 Less 时使用 --style less。

## 从配套套件创建

若只有包含 manifest.json、packages 的套件，在一个新工具目录执行，替换所有 /path/to/bundle：

```bash
npm init -y
npm install --save-dev /path/to/bundle/packages/xiaobaibaifqy-jingchuanchu-tooling-0.5.0-rc.1.tgz
npx --no-install jingchuanchu create ./my-game --bundle /path/to/bundle
cd my-game
npm install
npm run check
npm run dev
```

也可直接在配套套件的 starters/browser 中 npm install、npm run dev；直接运行该 starter 时需保留它与 packages 的相对位置。要得到独立可移动项目，优先使用 create 的 vendor 流程。

## 先跑通参考游戏

首页确认昵称→查看关卡→选定并开始→点击画布后使用方向键/WASD，也可点选目标或使用虚拟按钮。收集微光或等待倒计时结束，再进入结算。HUD/ESC 可暂停、继续或重开；进入设置会离开本局。

游戏页点击“启用并试听声音”才尝试解锁音频；静音和音量在设置页调整。设置页“保存设置”和结算页“保存进度”分别保存白名单数据；刷新后主动读取。不恢复上次进行中的实体或局面。

此流程是人工使用步骤，不能据静态构建声称真实浏览器/音频验收通过；验收记录见 [检查清单](../../tasks/acceptance.md)。

## 修改哪个文件

| 目标                         | 默认位置                                |
| ---------------------------- | --------------------------------------- |
| 应用配置、主题选择、Provider | src/app/app-config.ts                   |
| 路由与参数准备               | src/app/app-routes.ts                   |
| 页面 TS/HTML/CSS 或 Less     | src/pages/页面名/                       |
| 参考游戏移动、收集、计时规则 | src/pages/play/play-scene.ts            |
| 跨页会话、偏好、高分         | src/game/session、preferences、progress |
| 默认与派生主题、图片映射     | src/themes/default、dusk                |
| 音频资源与许可               | src/assets/audio                        |

文件名用小写 kebab-case，组件三文件同名。main.ts 负责启动与基础样式，业务逻辑放在所属页面或游戏域。

## 新增功能

```bash
npm run generate -- page bonus --route /bonus
npm run generate -- component score-editor --shared
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme forest --extends default
```

页面会注册路由；组件需父级显式引用；场景需显式传给 GameCanvas；主题需在 AppConfig 中选择。生成器不覆盖已有业务，不自动启动场景。完整可照写的代码见 [组件与页面教程](application-components.md) 和 [场景教程](application-gameplay.md)。

## 构建、预览与保存项目

```bash
npm run check
npm run build
npm run preview
```

check 检查结构、模板/资源和 TypeScript，build 再生成游戏 dist，preview 地址以终端为准。部署游戏 dist 中的静态网页；默认 hash 路由无需服务端按页面路径回退，若改 history 模式则配置静态服务回退到 index.html。账号或网络服务端另行部署。

保存源码、vendor、package.json、package-lock.json 和素材许可；协作者按锁文件 npm ci，并在所用操作系统中安装依赖。不要提交 node_modules。修改引擎源码不会热更新已复制的 vendor，升级需重新构建和更新本地依赖，见 [分发指南](distribution.md)。

## 只安装基础模块

已有引擎宿主、只需 ECS/Canvas/网络的项目，可使用套件安装器；它不生成页面或 UI：

```bash
node /path/to/bundle/install.mjs --modules core,assets --target ./existing-project --dry-run
node /path/to/bundle/install.mjs --modules core,assets --target ./existing-project
```

安装器补齐内部依赖并校验摘要，依赖引用套件内的 tgz，应保留其位置。application 项目增加能力优先用 `jingchuanchu add --modules assets,net --bundle /path/to/bundle` 保存到 vendor。底层开发见 [ECS 与循环](ecs-and-loop.md)。
