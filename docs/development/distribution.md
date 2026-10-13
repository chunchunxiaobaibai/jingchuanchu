# 分发与版本维护

## 交付给其他开发者

当前采用本地分发归档，不需要 npm 账号、作用域权限或引擎仓库访问权。
把 `jingchuanchu-engine-0.3.0.tar.gz` 与对应 `.sha256` 文件一起交给使用者。解压后打开 README 和手册，选择安装模块或运行 starter。

归档含 npm tgz、每包 README/LICENSE/源码/ESM/声明、整套开发文档、安装器和示例。单机无需安装 ws 或联网游戏规则；服务端安装会正常从 npm 获取 ws。
SHA-256 检查确认文件与分发清单一致，不代替发行者身份的验证。

## 在引擎仓库生成分发包

```bash
npm ci
npm run typecheck
npm test
npm run test:distribution
```

最后一步自动构建 8 个包、npm pack、生成归档，并在临时外部项目验证安装器、类型声明、可运行示例与 starter。
浏览器验证需要 Chromium，首次运行先执行 `npx playwright install chromium`；Linux 还需对应浏览器运行库。
单独生成、不运行完整外部验证：`npm run dist:release`。

```text
dist/releases/
  jingchuanchu-engine-0.3.0/          可直接查看与使用的目录
  jingchuanchu-engine-0.3.0.tar.gz    交付归档
  jingchuanchu-engine-0.3.0.tar.gz.sha256
```

生产机器需要 Node >=22.12、npm、tar，构建与测试使用仓库锁文件。归档不包含 node_modules、游戏房间数据、环境配置或个人浏览器资料。

## 不同安装方式

1. 安装器：选择 preset 或 modules，自动选择内部依赖并验证所选 tgz。
2. 原生 npm：同时提供所选包和内部依赖的 tgz；例如 core 同时需要 ecs。只给 core 会尝试从 registry 查找 ecs。
3. 私有或公共 registry：发布后按正常 npm 包名安装，依赖由 registry 解析。

源码中 `source` 条件用于本仓库开发，外部消费默认 ESM/.d.ts。不要把整个 workspace 的 Node 运行参数复制到消费者配置中。
每个引擎包都包含 MIT LICENSE。发行归档的模板和文档也采用同一授权；保留许可证原文。

## 如需发布 npm

发布目标为公共 registry `https://registry.npmjs.org/`，包名为 `@xiaobaibaifqy/jingchuanchu-*`。每次发布前核对登录账号、目标版本与安装包，使用已验证的 tgz；包配置已指定 public 访问权限。

账号需要满足 npm 的发布认证要求，只有登录成功还不够。若收到“Two-factor authentication … required”错误，在 Windows 浏览器的 npm Account 页面启用 2FA，再用 `npm login --auth-type=web --browser=false --registry=https://registry.npmjs.org/` 重新登录；复制终端链接到 Windows 浏览器完成验证。不要把密码、token 或恢复码发给其他人。

内部依赖发布顺序为 ecs → core → browser/input/assets/renderer-2d/net → net-server。
使用各包的 tgz 可以保证上传的内容与已验证产物一致。执行 `npm publish ./dist/packages/xiaobaibaifqy-jingchuanchu-ecs-0.3.0.tgz --access public --registry=https://registry.npmjs.org/`，依序发布其他模块。发布同一个名字/版本不可覆盖；首次发布后核对远端 integrity，并在外部项目按包名安装验证。不要把认证配置或凭据放进源码、README 或分发归档。

## 维护版本

root 和所有引擎包使用同一版本，内部依赖范围跟随版本；此发行版为 0.3.0。
改变 API 时更新 CHANGELOG、API 参考、模板与消费测试，重新生成包，不直接修改已生成的 dist。
外部项目应保存 lockfile；升级时更新引擎包及其内部依赖，并运行自己游戏的类型检查、逻辑测试和浏览器验证。

分发构建会检查版本统一、MIT 文件、公开入口和打包文件，输出清单以及源码 Git revision。建立正式版本标记后可据 revision 重现此发行版。

依据：[npm package.json](https://docs.npmjs.com/files/package.json/)、[MIT 原文](https://opensource.org/license/mit)。
