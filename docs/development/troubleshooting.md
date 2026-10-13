# 常见问题

## 安装时出现 @xiaobai 包 404

目前未上传公共 npm。只安装一个 core tgz 时，npm 仍需要找到 ecs。使用分发 install.mjs 自动补齐全部所需本地包，或一次把所需 tgz 都传给 npm。

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

依赖写模块 ID，例如 keyboard-input，不是 @xiaobai/input。先安装依赖或同批提供。已经安装的 ID 不可重复；运行状态先 pause/stop 再 install。
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
