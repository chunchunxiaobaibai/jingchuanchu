# 常见问题

当前 application 使用流程见 [快速入门](getting-started.md)，函数/返回状态见 [应用 API](application-api.md)。先区分新 application 子入口与旧根入口；下方 Engine.install/start 等说明用于直接管理底层引擎的项目，不是给 GameCanvas 额外启动一套循环。

## 找不到 app/application 或 defineComponent

确认安装的是由包含 packages/app/application.ts 的源码构建的配套 tgz。历史同版本 0.4.0 包未必提供子入口；不要靠给外部项目添加 source 条件、导入引擎源码路径或修改 node_modules 绕过缺失导出。当前源码更新后需重建包；已有 vendor 不随引擎源码热更新。同名同版本但不同内容的包，优先用新套件创建项目并迁移，避免旧锁文件/附件缓存混淆。

## Windows/WSL 报 esbuild 或 Rollup 平台不匹配

不要让 Linux Node 使用 Windows 安装的原生依赖，也不要反向共用。选择实际运行的平台，在该平台按锁文件重新安装，或使用分开的工作目录。先核对 node --version 和执行路径；这类启动失败不等于测试断言失败。不要为解决平台问题随意改业务依赖版本。

## 新项目的 generate view / scene menu 失败

application 模型使用 generate component/page/scene/store/theme。组件要选 --page 或 --shared，页面需要 --route，场景需要 --page，Store 需要 --domain。页面创建会注册路由，组件/场景仍需业务显式装配。generate view 和旧自动注册规则只适用于 legacy-v0.4。默认参考模板已有 play、game、default 等名称，冲突时不要删除原文件绕过保护。

## 模板缺少编译结果、找不到三文件或表达式报错

确认 vite.config.ts 使用 tooling/vite 的 jingchuanchu 插件，工厂从 app/application 具名导入，定义赋给具名变量、元数据是对象字面量。HTML 和可选 CSS/Less 同主名，或明确 templateUrl/styleUrl。不要同时留下同名 CSS/Less 而未明确选择，也不要手写 $template/$bindings。

按诊断给出的原 HTML 行列修复：模板只访问 setup 暴露成员，signal/computed 自动读取；不能写赋值、全局访问、类型断言或成员方法调用。把 items.map(...)、name.trim() 等逻辑提到 TS 公开操作/派生中。未知子标签先检查 components 注册，input/output 的 camelCase 在 HTML 用 kebab-case。

## model 不可写、数字变成字符串或 select 不同步

只读 Store.state、computed 和 input 不能作为 model 目标；用本地可写 signal 或 writableModel({get,set}) 将更新交给 Store action。数字/多选分别显式 convert:'number'/'strings'，复选框用 model:checked。同一属性不同时写 :value 和 model:value。

空数字/非法数字会保留编辑草稿与 validation，不强制写 0；resetDraft 才显式恢复。当前源码已修复动态选项首次渲染的选择同步；旧包出现该行为时需重新构建/更新配套包。程序回写不应触发 input/change。

## DataCloneError：无法把函数或 Canvas 放进状态

signal/computed、默认 input、场景 props 与应用根 inputs 处理普通数据快照。场景定义、DOM、图片、驱动和 Store 实例不属于可序列化状态。GameCanvas 的 scene/options 是显式引用输入，页面用 getScene() 传定义并保留稳定 options 对象；不能把场景包在 computed 或 signal 里。自定义组件确有能力引用需要时声明 `input<T>({required:true,mode:'reference'})`，内部变化不自动追踪。

## 路由无出口、链接没内容或导航未成功

RouterOutlet/RouteLink 要显式加入根/页面 components；默认投影使用 template slot="default"。带参数页面的输入由 route.prepare 返回，不自动获得整份 params。导航结果检查 status，cancelled/denied/failed 不是提交成功。preload 只加载代码，不挂载页面；自动预加载还需路由 opt-in，受保护链会跳过。

默认 hash 路由。history 模式刷新 404 时检查静态宿主的 index.html 回退和 router.base。通过 Router 导航，不在外部手写 location.hash 或原生 History 改写其托管状态。

## GameCanvas 空白、重复循环或 options 更新报错

确认父容器有实际 CSS 尺寸，game-canvas 是 display:block 且宽高可计算；检查 error 输出及场景必需 props。options 在挂载中固定，不每次渲染新建对象。scene 定义必须经 defineGameScene，页面注册 GameCanvas 并用引用输入传入。零尺寸不会产生可见绘制。

不要对同一画布额外安装 browserModule、runBrowser、createActions 或定时驱动；GameCanvas 已持有它们。键盘先点画布聚焦，编辑控件/快捷键/输入法组合不会被玩法接管。暂停保留 HUD；离页销毁而非仅隐藏 DOM。反复导航的帧和资源表现仍须实际浏览器验收。

## 资源声明正确但 JSON 加载失败，或离页后 lease.get 报错

默认参考 createBrowserAssetTransport 只接图片/图集与音频，不内置 JSON fetch；按 [资源教程](application-services.md) 扩展 transport。图片需真实尺寸和 source，atlas 帧不能越界；JSON parse 同步验证原始数据。引擎 CancellationSignal 不是 DOM AbortSignal，fetch 要桥接。

owner 退出或显式 release 后不能再读取 lease；先复制需要保留的纯数据，活动 Canvas 图像则保留所属租约。覆盖主题失败只回退最初默认一次，取消不回退；读取 diagnostic 和 onError，不把所有失败视为资源仍在加载。

## 音频没有声音或保存没有恢复

audio 需要配置 assets 和同步 driver 工厂。真实点击事件中先调用 unlock 再 await，不要先等网络；检查 ready/blocked/failed/cancelled、静音与 master/effects 音量。played 也不能证明设备实际可听，未解锁不会积压补播。默认模板的偏好 Store 由 main.ts 显式绑定到音频；仅改未绑定的 UI 状态不会调节设备。

存档不是自动保存/自动恢复。只有 save 返回 saved 才显示成功；load 为 loaded 时由业务显式 restore，其他状态保留当前值并提示。检查 key/version/namespace、浏览器存储权限，以及读取期间的编辑/取消代次。不清空整个 localStorage 来掩盖坏档；按指定定义 reset，或在可控测试数据中检查原记录。

## 生命周期的 exposed 推断为空，或内联 guard 类型变成 string

当前将 setup 写在使用 context.exposed 的钩子前，或提供完整显式泛型。守卫用 GuardResult 返回标注，或先 defineRoutes 再传给 defineApplication。根 inputs 的引用型限制、推断限制仍保留在 [任务记录](../../tasks/todo.md)，不能因为参考模板有可行写法就认为这些限制已消失。

## Windows 打包出现 tar: Cannot connect to D: resolve failed

这是部分 GNU tar 把归档参数中的 Windows 盘符冒号解释成远程主机地址，不代表引擎在连接网络服务器。分发脚本应在 dist/releases 工作目录下，以相对文件名生成归档；当前源码已按此方式修正，同时兼容系统 tar。

如果使用旧的 v0.4.0 源码且已经生成 dist/releases/jingchuanchu-engine-0.4.0 目录，可在仓库根目录的 PowerShell 或 Bash 手动完成最后一步：

```bash
cd dist/releases
tar -czf jingchuanchu-engine-0.4.0.tar.gz jingchuanchu-engine-0.4.0
```

这条手动命令只生成归档，不生成新的 SHA-256 文件；不要沿用旧归档的校验文件。需要完整归档和配套校验时，应用脚本修复后在仓库根目录执行 `npx tsx scripts/distribution/build.ts`，无需重新编译已经成功生成的各包。

## 安装时出现 @xiaobaibaifqy 包 404

确认使用 `@xiaobaibaifqy/jingchuanchu-*` 名称，旧的 `@xiaobai/*` 为本地开发名称。只安装一个 core tgz 时，npm 仍需要找到 ecs。使用分发 install.mjs 自动补齐全部所需本地包，或一次把所需 tgz 都传给 npm。

## 移动项目后 npm ci 找不到 tgz

file 依赖仍指向原安装包位置。保留归档位置，或把 tgz 放入项目 vendor 并重新安装为相对 file 依赖。需要团队统一获取时使用团队 registry 或共享分发文件。

## 模板缺少 TypeScript、Vite 或 Node 类型

构建需要 devDependencies。环境设置了 NODE_ENV=production 或 npm omit=dev 时，运行 `npm install --include=dev`，再 check/build；运行时只部署最终网页，不部署开发依赖。

## TS 报 NoInfer 不存在

使用 TypeScript 5.4 或更高版本。不要依赖关闭声明检查来掩盖版本问题。附带 starter 固定了已经验证的 TS 版本。

## ESM、NodeNext 和 Bundler 的区别

浏览器 Vite 项目用 module=ESNext、moduleResolution=Bundler。Node TS 项目用 NodeNext 并设置 package.json type=module，源码相对导入写 .js 扩展名。
不要在浏览器导入 net-server，它依赖 node:http、node:crypto 与 ws。

## 已安装模块但没有画面

install 是配置，不是启动，确认调用 engine.start 并安装 browserModule。确认 Canvas 有可见 CSS 尺寸、实体同时具备 Position2D 和 Shape2D，以及没有处于 paused/stopped。
禁用 renderWorld 后需要自己的 render 系统。不要在同一帧让内置绘制和自己的 clear 把对方画面覆盖。

## 我定义了同名 Position，系统却查不到

token 按身份区分，不按字符串名称。只在共享组件文件中定义一次，其他文件共同导入；不要复制 component('Position') 或安装同一引擎包的不同版本。

## 安装模块出现重复或缺失依赖

依赖写模块 ID，例如 keyboard-input，不是 @xiaobaibaifqy/jingchuanchu-input。先安装依赖或同批提供。已经安装的 ID 不可重复；运行状态先 pause/stop 再 install。
没有单模块卸载；要更换整套组合，dispose 旧 Engine 后创建新实例。

## pause 后网络仍然收到消息

这是当前契约：pause 停逻辑/绘制驱动，不关闭网络。暂停时仍可能更新 UI 或接收权威状态。要关闭网络用 stop 或显式 connection.close，并由游戏处理状态恢复。

## WebSocket send 返回 false

还未 open、已经关闭，或积压超过阈值。等待 open 状态后发送，false 时自行决定是否重试。不要自动重试有重复副作用的游戏命令而不带操作编号。

## Origin 被拒绝

检查浏览器页面的完整 Origin、请求 host 和服务端 allowedOrigins。示例放行 localhost:5175 与 127.0.0.1:5175；换端口或部署域名后同步更新配置。HTTPS 页面应使用 WSS。

## 停止了游戏，计时器或监听器还在运行

stop 保留实例，dispose 才释放 scope。模块自己的 DOM 监听器、定时器与实体必须 scope.own。异步服务器 close 需显式 await，Scope 不等待 Promise。

## 发布 archive 与单个 npm 包有什么差别

archive 是开发者交付套件，含手册、模板和全部可选包；tgz 是一个模块的 npm 安装单元。可以传完整套件，让使用者按需安装，不代表每个游戏都加载所有模块。
