# 分发与版本维护

## 交付给其他开发者

本文描述当前源码的本地分发归档。当前预发布版本为 0.5.0-rc.1，但历史同名附件不包含当前源码的全部能力；交付时记录源码快照和归档摘要。不需要 npm 账号、作用域权限或引擎仓库访问权。
把 `jingchuanchu-engine-0.5.0-rc.1.tar.gz` 与对应 `.sha256` 文件一起交给使用者。解压后打开 README 和手册，选择安装模块或运行 starter。

归档含 npm tgz、每包 README/LICENSE/源码/ESM/声明、整套开发文档、安装器和示例。单机无需安装 ws 或联网游戏规则；服务端安装会正常从 npm 获取 ws。
SHA-256 检查确认文件与分发清单一致，不代替发行者身份的验证。

## 在引擎仓库生成分发包

```bash
npm ci
npm run dist:release
```

dist:release 构建 10 个包、打包 tgz、检查模板并生成归档，不自动上传或启动浏览器。需要独立包消费验证时，执行 npm run test:app:distribution；需要完整 Node 分发验证时，执行 npm run test:distribution:node（会重新构建套件并验证安装器、独立示例/模板与实际网络往返）。不要因文档修改重复运行分发或全量检查。test:2d/test:distribution 会启动浏览器，仅在明确安排时执行。

```text
dist/releases/
  jingchuanchu-engine-0.5.0-rc.1/          可直接查看与使用的目录
  jingchuanchu-engine-0.5.0-rc.1.tar.gz    交付归档
  jingchuanchu-engine-0.5.0-rc.1.tar.gz.sha256
```

生产机器需要 Node >=22.12、npm、tar，构建与测试使用仓库锁文件。归档不包含 node_modules、游戏房间数据、环境配置或个人浏览器资料。

## 不同安装方式

### Windows 现有项目

生成套件后，在 PowerShell 执行（替换自己的项目路径）：

```powershell
node "E:\CodexProject\xiaobaifqy-engine\dist\releases\jingchuanchu-engine-0.5.0-rc.1\install.mjs" --preset singleplayer --target "E:\MyGame"
```

`core` 只安装内核；`singleplayer` 安装网页单机模块；`client` 加入网络客户端；`server` 安装服务端及其依赖。安装器直接使用本地 tgz，无需 npm 登录或发布权限。`--offline` 表示不访问 registry，服务端的 `ws` 必须已经缓存。

安装后仍通过公开包名引用，例如：

```typescript
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
```

### 项目独立保存安装包

直接使用安装器时，项目依赖指向分发目录。要让项目迁移后仍能 `npm ci`，把选中的 tgz 及其内部依赖一起复制到项目 `vendor/`，然后在项目目录重新安装。仅内核示例：

```powershell
npm install ./vendor/xiaobaibaifqy-jingchuanchu-ecs-0.5.0-rc.1.tgz ./vendor/xiaobaibaifqy-jingchuanchu-core-0.5.0-rc.1.tgz
```

网页单机还需 browser、renderer-2d、input、assets；网络客户端再加 net，服务端再加 net 和 net-server。一次安装全部选中包，避免内部 `^0.5.0-rc.1` 依赖去公共 registry 查找尚未发布的版本。保存 `vendor/`、`package.json` 和 `package-lock.json`；升级引擎后重新打包并安装同一版本的全部选中包。

### 方式比较

1. 安装器：选择 preset 或 modules，自动选择内部依赖并验证所选 tgz。
2. 原生 npm：同时提供所选包和内部依赖的 tgz；例如 core 同时需要 ecs。只给 core 会尝试从 registry 查找 ecs。
3. 私有或公共 registry：发布后按正常 npm 包名安装，依赖由 registry 解析。

源码中 `source` 条件用于本仓库开发，外部消费默认 ESM/.d.ts。不要把整个 workspace 的 Node 运行参数复制到消费者配置中。
每个引擎包都包含 MIT LICENSE。发行归档的模板和文档也采用同一授权；保留许可证原文。

## application 项目保存与升级

新项目优先用配套 tooling create --bundle：自动复制依赖闭包到 vendor，离开套件目录仍可重建。已有 application 项目用 add --modules 选择模块并写入 vendor，再 npm install 更新锁文件。--all 包含服务端包，不适合无差别加入网页项目。

同一套件内的已有相同字节附件可复用；同名不同字节附件拒绝覆盖。若同版本号源码快照与历史产物内容不同时，优先新建项目并迁移业务，不覆盖旧 vendor 后期待相同 file 依赖自动更新。真实版本升级需同步选中的所有内部依赖，保存来源、摘要和锁文件，并重新 check/build 与游戏验收。

如需发布 npm，由独立发布任务按 [维护手册](../maintainers/npm-publishing.md) 执行；不能把 dist:release 当作远端发布。本地安装不要求 npm 发布权限。

## 维护版本

root 和所有引擎包使用同一版本，内部依赖范围跟随版本；当前源码版本为 0.5.0-rc.1，作为 GitHub 预发布交付，npm 发布仍是独立操作。
改变 API 时更新 CHANGELOG、API 参考、模板与消费测试，重新生成包，不直接修改已生成的 dist。
外部项目应保存 lockfile；升级时更新引擎包及其内部依赖，并运行自己游戏的类型检查、逻辑测试和浏览器验证。

分发构建会检查版本统一、MIT 文件、公开入口和打包文件，输出清单以及源码 Git revision。建立正式版本标记后可据 revision 重现此发行版。

依据：[npm package.json](https://docs.npmjs.com/files/package.json/)、[MIT 原文](https://opensource.org/license/mit)。
