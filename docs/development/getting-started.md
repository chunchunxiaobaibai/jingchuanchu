# 快速入门

## 路线一：使用附带的可运行项目

解压分发归档，保留 `packages` 与 `starters` 的相对位置：

```bash
cd jingchuanchu-engine-0.3.0/starters/browser
npm install
npm run dev
```

访问 http://localhost:5175 。方向键或 WASD 移动圆形角色，点击画布设置目的地。暂停按钮控制 Engine。
`npm run check` 验证 TS，`npm run build` 生成 `dist` 静态网页，`npm run preview` 在 4175 端口预览构建结果。

安装时从归档中的本地 tgz 获取引擎，Vite 和 TypeScript 从 npm 获取。现有项目也可以通过公共 npm 安装 `@xiaobaibaifqy/jingchuanchu-core` 等所需模块。

## 路线二：接入自己的项目

在你自己的项目目录运行安装器，下面路径替换成实际解压位置：

```bash
node /path/to/jingchuanchu-engine-0.3.0/install.mjs --preset singleplayer
```

预设及用途：

| 预设         | 包含的能力                            |
| ------------ | ------------------------------------- |
| core         | ECS 与手动推进的引擎内核              |
| singleplayer | core、浏览器循环、绘制、输入、资源    |
| client       | singleplayer + 浏览器网络             |
| server       | core + 房间/消息基础 + Node WebSocket |

只选择部分模块：

```bash
node /path/to/bundle/install.mjs --modules core,assets --target ./my-game
node /path/to/bundle/install.mjs --preset singleplayer --dry-run
```

安装器自动补齐内部依赖并核对所选 tgz 的 SHA-256。`--dry-run` 只验证和列出包，不写项目。
`--offline` 要求所有 npm 所需外部依赖已缓存；core 和 singleplayer 的引擎包没有外部运行依赖。
已有项目的 package.json 由 npm 按正常安装行为更新；没有 package.json 时安装器生成一个私有 ESM 项目。

安装后引擎路径写入项目依赖。不要删除这些 tgz 后再尝试 `npm ci`。需要移动项目时，把选中的 tgz 放入项目的 `vendor/` 并重新以本地相对路径安装，或使用你自己的包 registry。

## 应用的最小配置

安装 Vite 和 TS 后，浏览器项目可以使用：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

消费分发包不需要配置 `source` 条件，不需要 tsx，也不需要引用 `packages/.../index.ts`。构建器通过公开入口获得 ESM，TS 获得 `.d.ts`。

## 理解模板的三层

- `index.html`：Canvas 和控制按钮。
- `src/main.ts`：安装 browser、renderer、input，把 DOM 操作转换成游戏意图。
- `src/game.ts`：你的 Entity、Component、System 和资源，修改这里实现玩法。

入口中的安装方式：

```ts
engine.install([
  canvas2DModule({ canvas }),
  keyboardModule(),
  gameModule(),
  pointerModule({ canvas, handlers }),
  browserModule(),
]);
engine.start();
```

这里的 `canvas`、`handlers` 和 `gameModule` 都由应用提供，完整定义在模板源码中。
安装模块负责准备服务，`start()` 才启动循环；只安装 core 不会自动创建动画帧、Canvas 或 WebSocket。

从模板继续开发，可以先加入自己的组件，创建敌人或目标，再添加处理这些组件的系统。网络功能可以在单机规则稳定后单独接入。
