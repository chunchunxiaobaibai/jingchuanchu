# @xiaobaibaifqy/jingchuanchu-renderer-2d

Jingchuanchu (镜川初) TypeScript engine renderer-2d module。版本 0.5.0，MIT 授权。

开发指南、参数及使用约束统一在配套套件的 docs/index.html；API 见 docs/api/renderer-2d.html。源码仓库内打开 ../../docs/index.html。

包提供编译后的 ESM 和 TypeScript 声明。请使用同一版本套件的配套依赖；浏览器项目只安装所需模块，tooling 作为开发依赖。

0.5.0 新增 `TransformFrameCache`：帧级缓存已计算的 Transform 矩阵，渲染与碰撞检测可共享同一缓存实例避免重复计算。`detectCollisions(world, cache?)` 接受可选缓存参数；无参数调用保持原行为。
