# 从源码构建引擎与游戏

适用于希望自行构建、研究或修改镜川初的开发者。当前稳定交付为 GitHub v0.4.0，npm 0.4.0 暂未发布；构建及使用本地包无需 npm 登录。只想制作游戏时，也可直接使用 [预构建 Release](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.4.0)。

完整流程是：获取源码 → 安装引擎开发依赖 → 构建分发套件 → 创建独立游戏 → 开发与构建游戏。

## 1. 环境准备

- Node.js >=22.12、npm。
- Git，用于获取源码及记录构建来源；tar，用于生成分发归档。
- 安装开发依赖需要网络或已缓存依赖，不需要 npm 发布权限。

```bash
node --version
npm --version
git --version
tar --version
```

命令可在 PowerShell、Bash 或 WSL 中执行。选择一种平台完成安装与构建，不要让 Windows 和 WSL 共享同一份已安装的 node_modules；切换平台后在该平台重新执行 npm ci。

## 2. 获取对应源码

构建与已发布附件对应的 0.4.0，推荐固定标签：

```bash
git clone --branch v0.4.0 https://github.com/chunchunxiaobaibai/jingchuanchu.git
cd jingchuanchu
```

标签检出后处于 detached HEAD 是正常状态，适合构建固定版本。如果要修改引擎，可先创建自己的分支：

```bash
git switch -c my-engine-changes
```

如果希望跟随尚在更新的源码，改为克隆 dev；它可能与现有 Release 内容不同：

```bash
git clone --branch dev https://github.com/chunchunxiaobaibai/jingchuanchu.git jingchuanchu-dev
cd jingchuanchu-dev
```

两种获取方式任选一种，不要连续执行两套 cd 命令。GitHub 的 Source code 压缩包也只有源码，没有预构建引擎包；需要完整构建来源记录时采用 Git 克隆。

## 3. 构建引擎分发套件

在包含根 package.json 的引擎仓库目录中执行：

```bash
npm ci
npm run dist:release
```

npm ci 按锁文件安装依赖并建立 workspace 链接。dist:release 执行类型检查、编译与打包各包、模板结构/组件/类型检查，最后生成分发归档；不会自动打开浏览器，也不会推送 GitHub 或发布 npm。

0.4.0 的主要产物为：

```text
packages/<模块>/dist/                       编译后的 ESM、声明及开发工具
dist/packages/*.tgz                         10 个包的本地安装包
dist/releases/jingchuanchu-engine-0.4.0/    解压形式的完整套件
dist/releases/jingchuanchu-engine-0.4.0.tar.gz
dist/releases/jingchuanchu-engine-0.4.0.tar.gz.sha256
```

该命令自动生成 tar.gz；GitHub Release 中另外提供的 ZIP 是同内容的分发附件，不是此命令的默认输出。版本号改变后，产物目录及文件名随根 package.json 的 version 改变。

如仅维护引擎代码，可按需求选择更小的命令：

| 命令                  | 用途                               |
| --------------------- | ---------------------------------- |
| npm run typecheck     | 仅检查类型，不产生构建文件         |
| npm run build         | 类型检查并构建各包，不生成完整套件 |
| npm run pack:packages | 构建并生成各包 tgz                 |
| npm run dist:release  | 生成可用于创建游戏的完整套件       |

## 4. 创建独立游戏

继续在引擎仓库根目录执行：

```bash
node packages/tooling/dist/cli.mjs create ../my-game --preset singleplayer --style css --bundle ./dist/releases/jingchuanchu-engine-0.4.0
```

my-game 创建在引擎仓库的同级目录，目标目录必须不存在或为空。生成器校验套件中的包，复制所需 tgz 到游戏 vendor，并写入相对 file: 依赖；它不会自动安装依赖或启动服务。

可将 `--style css` 改为 `--style less`。可选预设为 core、singleplayer、client、server；此处的后续命令按网页单机项目说明，其他预设见 [应用套件手册](application-suite.md)。

```bash
cd ../my-game
npm install
npm run dev
```

默认访问 http://localhost:5175 。以后开发游戏只需进入 my-game，不必每次重新构建引擎。引擎仓库根目录没有 npm run dev 入口。

在生成的游戏目录中创建功能：

```bash
npm run generate -- view score-panel
npm run generate -- scene menu
```

组件自动生成 TS/HTML/CSS 或 Less，接入父组件引用及模板；场景加入 scenes，保留当前 initialScene。具体业务逻辑仍由游戏开发者编写。

## 5. 构建游戏网页

在 my-game 目录中执行：

```bash
npm run build
npm run preview
```

build 先检查项目结构、组件资源/绑定和 TypeScript，再执行 Vite，输出 my-game/dist。preview 默认在 http://localhost:4175 预览。将游戏 dist 的内容交给静态网站托管服务即可部署前端；网络客户端需要的服务端另行部署。

游戏 dist 是网页产物，引擎仓库的 dist 是安装包及分发套件，二者用途不同。上述 dev/preview 是开发者按需手动执行的服务命令，不表示项目已自动完成浏览器交互验证。

## 6. 保存与升级

保存游戏源码、vendor、package.json 和 package-lock.json。其他协作者拿到游戏项目后可执行 npm ci，无需再次构建引擎。不要把 node_modules 或游戏 dist 当成源码提交。

游戏通过 vendor 中的包消费引擎，修改引擎源码不会热更新到已有游戏。升级时重新构建套件，再更新游戏选择的所有引擎模块及其内部依赖，保存对应 vendor 和锁文件；不要只替换某个 JS 文件，或混装 0.3.0/0.4.0 内部包。详见 [本地分发与升级](distribution.md)。

引擎正常启动及静态构建不要求运行全部测试。修改源码后按变化选择相关类型、单元或打包检查；浏览器测试遵循项目约定，由维护者明确安排。
