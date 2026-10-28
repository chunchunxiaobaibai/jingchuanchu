# 页面、组件与场景应用开发

本指南描述当前源码中的 application 模型和完整网页 2D 参考模板。新入口为 `@xiaobaibaifqy/jingchuanchu-app/application`；历史 0.4.0 附件和旧根入口用法见 [旧应用套件手册](application-suite.md)。同名历史附件不能替代当前源码构建的包，发布版本号应由维护者在发布时确定。本次发布为新的 GitHub 预发布，不发布 npm，不替换历史标签或附件。

首次操作见 [快速入门](getting-started.md)；可照写的代码见 [组件与页面](application-components.md)、[2D 场景](application-gameplay.md)、[资源与服务](application-services.md)，函数/返回状态查询见 [应用 API](application-api.md)。

## 从源码或配套套件创建

先按 [源码构建指南](build-from-source.md) 安装依赖并生成本地套件：

```bash
npm ci
npm run dist:release
node packages/tooling/dist/cli.mjs create ../my-game --bundle ./dist/releases/jingchuanchu-engine-0.5.0-rc.1
cd ../my-game
npm install
npm run check
npm run build
npm run dev
```

这里的 dist:release 生成本地目录和压缩包，不上传 GitHub 或 npm。`--bundle` 指向包含 manifest.json 和 packages 的套件目录，CLI 校验摘要并复制依赖闭包到项目 vendor，package.json 使用相对 file 依赖。移动项目时保留 vendor 和锁文件；外部 Vite/TypeScript 等开发依赖仍由 npm 安装，离线安装要求它们已经缓存。

只有配套套件时，在一个工具目录运行：

```bash
npm init -y
npm install --save-dev /path/to/bundle/packages/xiaobaibaifqy-jingchuanchu-tooling-0.5.0-rc.1.tgz
npx --no-install jingchuanchu create ./my-game --bundle /path/to/bundle
```

CSS 是默认值；创建时加 `--style less` 使用同名 Less 三文件。singleplayer/client 都创建完整参考应用，client 仅额外提供 net 依赖，不自动连接后端。旧浏览器布局需明确加 `--profile legacy-v0.4`；core/server 仍保持各自无 UI 入口。普通消费项目不需要 source 条件、引擎仓库或修改 node_modules。

## 开发入口与业务归属

```text
src/
  main.ts                 启动、基础样式与应用级偏好绑定
  app/                    应用配置、路由、外壳、浏览器适配
  pages/                  home、level-select、play、settings、result
  pages/play/             场景、页面及私有 HUD/暂停面板
  game/session/           昵称、有限关卡和当前游戏会话
  game/preferences/       音量/静音及设置保存白名单
  game/progress/          最高分、通关记录及进度保存白名单
  themes/                 默认和派生主题、图标及素材说明
  assets/audio/           类型化声音组、WAV 和说明
  styles/                 全局基础样式
public/                   随构建复制的素材许可
scripts/                  结构检查与声音生成配方
```

页面使用 definePage，组件使用 defineComponent，应用使用 defineApplication。组件采用 setup、typed input/output/model；原生表单用 `model:value`、`model:checked`，事件用 `@click` 等。signal 保存本地草稿，computed 推导显示值，effect 和事件清理归所属 Scope。不要把场景函数或图片对象放进需要序列化的 signal/Store/场景 props；GameCanvas 的 scene/options 是显式引用输入，参考页面通过 `getScene()` 提供场景定义。

跨页游戏数据通过 context.useStore 获取应用内共享实例，不同应用隔离；页面私有状态留在页面。存储适配等应用服务通过 defineService/provideService 装配。game 不依赖 DOM、页面或 app，复用 UI 不直接读 Engine；游戏 Canvas 和场景属于游玩页，离页释放循环、实体、输入、资源和声音。

AppRoutes 使用命名路由、带参数关卡守卫和动态 import。预加载只加载页面代码，不实例化页面或启动游戏。GameCanvas 仅在道具图片就绪且导航已提交时创建；加载失败提供重试，图片加载中离页不会创建晚到 Canvas。

## 继续生成业务代码

```bash
npm run generate -- page bonus --route /bonus
npm run generate -- component score-panel --page bonus
npm run generate -- component icon-button --shared
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme custom
npm run generate -- theme forest --extends custom
```

参考模板已有 play 页面、game Store 和 default 主题，新增业务使用不同名称。页面可注册到路由，组件仍需在父定义 components 和模板中引用；场景显式交给所属页面的 GameCanvas，Store 通过 context.useStore 使用，主题在 AppConfig.theme 选择。生成不会替换现有业务、自动启动场景或静默切换主题。冲突诊断应先解决，不靠删除既有文件绕过保护。

## 项目配置与增量安装

默认配置 jingchuanchu.json 的 schemaVersion 为 2、profile 为 application、preset 为 singleplayer、style 为 css。paths 可分别设置 app/pages/game/components/themes/account；缺省值是 src 下的对应目录。路径须在项目内、小写 kebab-case、不重叠且不能借符号链接越界。可选 account 只声明归属，不自动创建登录目录。

create/generate/check --project 使用项目根目录，不向父目录猜配置。--style 仅决定本次生成的样式文件；改变配置不自动搬迁已有文件或重写旧导入。旧配置使用 legacy-v0.4 规则，不能只改 profile 就当作完成迁移。

在游戏项目中加入配套套件里的模块：

```bash
npm exec -- jingchuanchu add --modules net --bundle /path/to/bundle
npm install
npm run check
```

add 校验摘要并补依赖闭包，复制到 vendor，tooling 仅放 devDependencies；--all 会包含 net-server 等所有包，不是网页项目的默认选择。add 不自动运行 npm install，也不更新锁文件。jingchuanchu-packages.json（add 使用时生成）记录附件版本/摘要；已有不同字节的同名 vendor 文件会被拒绝覆盖。

同版本号源码快照与历史附件内容不同时，不应直接把新 tgz 覆盖进旧 vendor 或只重新 npm install；同名 file 依赖和锁文件可能仍解析旧内容。优先用新套件创建新项目，逐步迁移业务并重新验收。正式版本升级后再按 [分发指南](distribution.md) 同步所有选中内部包；不手改 node_modules。

## 换图、声音与保存

AppConfig.theme 可从 DefaultTheme 改为 DuskTheme。`ui.pause`、`ui.settings`、`game.collectible` 共用类型化语义契约；在主题映射中替换图片即可同时供控件和场景解析。图集区域到普通图是整体替换，不残留 frame；源图大小不改变道具显示尺寸或碰撞规则。主题 token 管颜色，三文件 CSS/Less 管布局。没有玩家上传或运行时换肤入口。

声音通过惰性 Web Audio 驱动接入，进入页面不自动解锁设备。点击“启用并试听声音”同步进入 unlock；未解锁不会积压音效。收集音效归场景，暂停/退出会停止；通关/超时提示归仍活动的游戏页，重开/离页停止。音量和静音沿用共享偏好，播放失败不阻塞游戏。三份原创 WAV 可用 `node scripts/generate-audio.mjs` 重建，图标/声音许可见各自 ASSETS.md 和 public 许可文件。

设置页显式保存/读取昵称和声音偏好；结算页独立保存/读取各关高分、通关记录。刷新后主动读取，不恢复活动 Entity 或上次进行中的游戏。坏档、不兼容和存储失败有提示，读取不自动删除原记录；编辑中/离页后的晚到设置读取不覆盖输入，旧进度与本次更高成绩合并。

## 旧项目如何兼容

| 旧项目做法                   | 新模型迁移方式                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| 根入口 defineView/defineGame | 保留原入口运行；迁移页面时显式导入 application 子入口                   |
| ui/components、旧模板绑定    | 按页面/组件职责迁移为 kebab-case 同名 TS/HTML/CSS 或 Less，重写绑定契约 |
| 全局展示快照/命令对象        | 页面 signal 草稿与业务 Store，使用 typed inputs/outputs/model 连接      |
| 手写视图切换与 Canvas 驱动   | AppRoutes/RouterOutlet 与页面拥有的 GameCanvas                          |
| 散落图片路径与整份状态持久化 | 主题语义键和显式 defineSave 白名单                                      |

兼容保留旧公开名称和包入口，不代表自动理解旧模板语法、旧业务目录或把旧存档猜成新结构。迁移在新分支/项目中逐页进行，旧项目可以继续使用配套 legacy profile；不要同时在一个默认页面挂两套入口。账号与权限是可选支线，单机参考项目不创建登录目录，也不连接账号后端。

## 检查与交付边界

npm run check 检查目录/模板/类型，npm run build 产生静态网页。项目保留 vendor、源码、素材许可和 package-lock.json；需要重建依赖时可按锁文件 npm ci。引擎维护者的独立打包消费报告在 dist/audit/application-package-report.json，完整任务状态见 [实施记录](../../tasks/todo.md)。

Node DOM、注入音频/画布和静态构建不代表真实浏览器、音频解锁、触控、焦点、后台恢复或性能验收。实际游玩与设备检查单独记录；没有测量不填性能结论。

维护者可把验证套件放到单独目录，保留已有本地分发文件：

```bash
npx --no-install tsx scripts/distribution/build.ts --output-dir dist/audit/distribution-check
npx --no-install tsx scripts/distribution/verify.ts --archive dist/audit/distribution-check/jingchuanchu-engine-0.5.0-rc.1.tar.gz --skip-browser
npm run test:app:distribution
```

前两条命令使用已经构建的 dist/packages；首次构建仍按上文执行 dist:release 或 build:packages/pack:packages。`--skip-browser` 不加载或启动浏览器验收分支。test:app:distribution 与 test:app:package 使用同一实际 tgz 消费验证，覆盖完整 CSS/Less 和显式 legacy 项目，不需要重复执行两次。
