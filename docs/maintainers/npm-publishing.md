# npm 发布手册

用于镜川初维护者，保留给未来决定发布 npm 时使用。当前仅通过 GitHub 源码和本地套件交付 0.4.0，暂不执行下述发布操作，见 [GitHub 交付说明](github-delivery.md)。游戏开发者使用 [本地应用套件](../development/application-suite.md) 即可，无须 npm 发布权限。

## 发布对象与现状

- 账号/作用域：`xiaobaibaifqy` / `@xiaobaibaifqy`。
- 当前已公开版本：8 个 `@xiaobaibaifqy/jingchuanchu-*` 包的 **0.3.0**；本地候选为尚未上传的 **0.4.0**。
- 本地共 10 个包，包含新增 app 运行包和 tooling 开发工具包；源码上传 GitHub 不会自动改变 npm 的版本。
- 根 package.json 为 `private: true`；不能在根目录直接执行无参数的 `npm publish`。
- 发布对象是 `dist/packages/*.tgz`；完整 tar.gz 是面向开发者的交付套件，不上传 npm。
- archive、测试及外部游戏不进入引擎运行包。tooling 是独立开发工具包，包含编译器、CLI 和项目模板；其开发依赖不进入核心运行包依赖。打包内容以各包 files 白名单为准。

0.3.0 已占用，不可覆盖。本地优化版本不自动发布。下一次改变包内容或 npm README，需要用新版本发布；不要移动现有 Git 标签。

## 1. 维护版本和元数据

当前仓库采用 10 个包统一版本，内部依赖为 `^同一版本`。选择新版本后更新：

1. 根 package.json 和所有 packages/*/package.json 的 version。
2. 根引擎依赖和各包内部引擎依赖范围。
3. CHANGELOG、适用版本文档、示例命令与分发说明；核对每包 README/LICENSE。
4. `npm install --package-lock-only --ignore-scripts` 更新锁文件，再检查 diff。

公开 API 的变化需要迁移说明；修复采用 patch，兼容的新功能采用 minor。0.x 期间破坏兼容的变化也必须明确标记并给出迁移步骤，不把它当作普通修复。

GitHub 仓库已配置为 https://github.com/chunchunxiaobaibai/jingchuanchu 。未来 npm 发布前可给根包和各子包补充 repository/homepage/bugs 信息，子包的 repository.directory 为 `packages/<模块>`。

## 2. 从干净环境验证

在仓库根目录：

```bash
npm ci
npm run build
npm test
npm run format:check
npm run test:distribution:node
```

tar 需在 PATH 中。默认分发验证不启动浏览器，包含包文件白名单、许可证、校验值、按需安装、外部 TS 编译、starter 静态构建与真实网络通信。另用 npm run test:app:distribution 验证应用套件 CLI 的独立消费。浏览器部分留给用户按需验证，只有显式进行 Linux 浏览器验证时才需要对应运行库。

检查每个 tgz 内容，确认是目标版本，例如：

```bash
npm publish ./dist/packages/xiaobaibaifqy-jingchuanchu-ecs-0.4.0.tgz --dry-run --json --registry=https://registry.npmjs.org/
```

以上是本地 0.4.0 产物的**预检示例**，不会上传；正式发布需确认目标版本仍未被上传。

## 3. Git 发行标记

验证通过后提交源码与文档，确认工作区干净，再为新版本创建 `v<版本>` 标签。标签必须与 root.version 相同。重新生成发行套件以记录最终 revision 和标签：

```bash
npx tsx scripts/distribution/build.ts
```

此步骤只更新交付套件，不重新编译或打包已验证的 tgz。确认 manifest.json 的 sourceDirty 为 false，sourceTag 和版本一致。已有 `v0.3.0` 保留原始发行版，不用于本次整理后的快照。

## 4. WSL 登录与认证

```bash
npm whoami --registry=https://registry.npmjs.org/
npm login --auth-type=web --browser=false --registry=https://registry.npmjs.org/
```

需要登录时执行第二条。WSL 无浏览器也可操作：复制 npm 给出的链接到 Windows 浏览器，完成认证后回到 WSL。

账号已开启发布 2FA。若 npm 为某次 publish 给出新的认证链接，仍需在 Windows 浏览器用安全密钥/Windows Hello 完成。不要把 .npmrc、密码、token、恢复码或个人认证链接提交到源码。

## 5. 上传已验证安装包

按依赖顺序：ecs → core → browser、input、assets、renderer-2d、net → net-server、app；tooling 无内部引擎包依赖，可单独发布。下面按顺序列出全部 10 个包。

下面是 Bash 示例，**仅用于实际决定发布新版本时**。将示例 `0.4.0` 核对为已验证且尚未上传的版本，核对账号后执行：

```bash
release_version=0.4.0
for module in ecs core browser input assets renderer-2d net net-server app tooling; do
  npm publish "./dist/packages/xiaobaibaifqy-jingchuanchu-${module}-${release_version}.tgz" \
    --access public --registry=https://registry.npmjs.org/ --browser=false || exit 1
done
```

失败后检查哪些模块已经成功，修复原因后只继续未成功的包。同一版本不可重复覆盖，已经成功的模块不重新发布。

npm 新包在可安装前会执行扫描，官方描述通常约 5 分钟，繁忙时可能 15 分钟或更久。临时 404 不等于发布失败，应等待并查询；不能用重复上传解决。

## 6. 核对远端与消费结果

对每个包检查 version、license、dependencies、dist.integrity，例如：

```bash
npm view @xiaobaibaifqy/jingchuanchu-core@0.3.0 version license dependencies dist.integrity --json --registry=https://registry.npmjs.org/
```

正式核对时改为新版本，并将远端 integrity 与本地 tgz 的 SHA-512 对照；交付清单的 SHA-256 用于另一层本地校验，两者算法不同。

在仓库外创建临时 ESM 项目，按公共包名安装指定新版本，不能用 file/tgz/workspace 替代：

```bash
mkdir registry-consumer
cd registry-consumer
npm init -y
npm pkg set type=module
npm install @xiaobaibaifqy/jingchuanchu-core@0.3.0 --registry=https://registry.npmjs.org/
```

此处也是当前发行版的消费示例。新版本核对需分别验证 core、网页单机组合和网络组合，编译并执行消费代码，保存锁文件，确认来自公共 registry。记录结果后再告知用户新版已可用。

## npm 页面展示

npm 页面主要展示每包自身 README。根 README 和仓库 docs 不会自动变成各包的 npm 页面。维护 README 时写清：包用途、安装命令、TS/ESM 条件、公开入口、最小用法、清理方式与文档入口；确认 `npm pack` 内确实包含它。

GitHub README 展示整个引擎；npm README 介绍当前模块；交付归档另外附完整开发手册。三处均应使用相同版本与真实项目地址。

依据：[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)、[npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/)、[npm 发布时扫描](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)。
