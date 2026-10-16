# 快速入门

## 从 GitHub 源码创建游戏

当前 0.4.0 使用 GitHub 源码和预构建套件交付，暂不发布 npm。希望自行构建时，先克隆并构建引擎，再创建独立游戏项目；详细步骤与产物位置见 [源码构建指南](build-from-source.md)。只想直接开发游戏，可使用下文的预构建归档。

```bash
git clone https://github.com/chunchunxiaobaibai/jingchuanchu.git
cd jingchuanchu
npm ci
npm run dist:release
node packages/tooling/dist/cli.mjs create ../my-game --preset singleplayer --style css --bundle ./dist/releases/jingchuanchu-engine-0.4.0
cd ../my-game
npm install
npm run build
npm run dev
```

选择 Less 时使用 `--style less`。生成器自动把所需 tgz 保存到游戏 vendor，项目可独立迁移；开发依赖仍从 npm 下载或缓存安装，无需登录 npm。下面两条命令在生成的游戏目录中使用：

```bash
npm run generate -- view score-panel
npm run generate -- scene menu
```

组件自动加入父组件引用及模板，场景自动加入 scenes，默认初始场景不变。运行时、绑定和生命周期详见 [应用套件手册](application-suite.md)。

## 路线一：使用附带的可运行项目

若已经获得构建后的分发归档，解压并保留 packages 与 starters 的相对位置。GitHub 的源码压缩包不等于此分发归档：

```bash
cd jingchuanchu-engine-0.4.0/starters/browser
npm install
npm run dev
```

访问 http://localhost:5175 。方向键或 WASD 移动圆形角色，点击画布设置目的地。暂停按钮控制 Engine。
`npm run check` 验证结构、组件资源/绑定及 TS，`npm run build` 生成 dist 静态网页，`npm run preview` 在 4175 端口预览构建结果。

安装时从归档中的本地 tgz 获取 0.4.0 引擎，无需 npm 发布权限，Vite 和 TypeScript 从 npm 获取。公共 npm 的引擎包仍为 0.3.0，使用当前版本请按下面的本地方式安装。

## 路线二：仅安装引擎模块到已有项目

在你自己的项目目录运行安装器，下面路径替换成实际解压位置：

这个安装器选择引擎模块并更新依赖，不生成应用目录或 UI；完整新项目使用上面的 CLI create。

```bash
node /path/to/jingchuanchu-engine-0.4.0/install.mjs --preset singleplayer
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

## 理解模板的职责边界

- `index.html`：空的 game-app 根宿主及唯一启动脚本。
- `src/main.ts`：全局样式与应用启动；`src/app` 通过 defineGame 配置模块、应用命令及输入适配。
- `src/game/scenes`、`components`、`systems`：场景组装、数据和更新规则。
- `src/ui/components`：defineView 声明与自动关联的同名 HTML、CSS 或 Less。
- `src/contracts`：UI/游戏之间的输入、命令和只读状态契约。

结构检查已接入 check 和 build。新建功能应遵循 [游戏项目规范](project-structure.md)，不要把界面和玩法重新集中进 main.ts。

模板入口通过定义引用启动：

```ts
import { bootstrapGame } from '@xiaobaibaifqy/jingchuanchu-app';
import { GameApp } from '../ui/components/GameApp/GameApp.js';
import { gameDefinition } from './game.js';

await bootstrapGame(GameApp, gameDefinition);
```

完整组装见模板 src/app/startApplication.ts 和 src/app/game.ts。应用套件负责挂载、主循环及资源清理；原有 Engine.install/start 仍可独立使用，见 [ECS 与循环](ecs-and-loop.md)。只安装 core 不会自动创建动画帧、Canvas 或 WebSocket。

从模板继续开发，可以先加入自己的组件，创建敌人或目标，再添加处理这些组件的系统。网络功能可以在单机规则稳定后单独接入。
