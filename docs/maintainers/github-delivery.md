# GitHub 源码与预构建套件交付

仓库：[chunchunxiaobaibai/jingchuanchu](https://github.com/chunchunxiaobaibai/jingchuanchu)，默认分支为 dev。本次版本为 **0.5.0-rc.1**，以 [GitHub 预发布](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.5.0-rc.1) 提供网页 2D 应用框架；不发布 npm。历史 [v0.4.0](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.4.0) 标签与附件保留。

## 源码、标签与附件

git push 只上传已提交的源码，不包含忽略的 dist/tgz。发布前检查全部修改、删除和未跟踪文件；不要把未提交实现遗留在仅本地工作区。每个包的 version 和内部依赖范围、模板、锁文件、文档命令使用同一版本。

先完成所需验证和源码提交，再创建尚未使用的 v<版本> 标签；不能移动旧标签或覆盖旧 Release 附件。本次保留 dev 作为源码入口，v0.5.0-rc.1 标记经过验证的候选。GitHub 的 Source code 附件没有预构建包，使用者仍需构建引擎。

## 构建与验证

在引擎根目录按本次交付需要执行：

```bash
npm run typecheck
npm run pack:packages
npm run check:templates
npm run test:app:distribution
```

前者构建实际 tgz，后者在仓库外验证 CSS/Less/legacy 的创建、安装、模板诊断、类型与静态构建。需要完整 Node 分发验收时，再执行 distribution/verify.ts --skip-browser；不要让这一选择隐式启动浏览器。具体版本/环境/命令与未验证部分记录在 [验证记录](../validation.md)。

从已提交、已标记且干净的源码重新装配归档：

```bash
npx --no-install tsx scripts/distribution/build.ts
```

这一步使用已有 dist/packages，不重复编译；确认 manifest.json 的 sourceRevision 是最终提交，sourceDirty=false，sourceTag=v0.5.0-rc.1。ZIP 与 tar.gz 应来自同一个目录、相同文件内容，分别生成 SHA-256。对外附件为：

```text
jingchuanchu-engine-0.5.0-rc.1.tar.gz
jingchuanchu-engine-0.5.0-rc.1.tar.gz.sha256
jingchuanchu-engine-0.5.0-rc.1.zip
jingchuanchu-engine-0.5.0-rc.1.zip.sha256
```

归档包括 10 个 tgz、包清单、安装器、参考游戏、开发文档和许可，不包括 node_modules、个人环境或外部游戏。独立生成项目将依赖复制到 vendor；套件内 starter 使用相对 packages 目录。使用流程见 [快速入门](../development/getting-started.md)。

## 上传与发布

将源码提交和新标签推送后，先创建 draft + prerelease 的 GitHub Release，说明正文采用 [本版本说明](release-0.5.0-rc.1.md)。上传四份附件，核对名称、大小和远端摘要，再发布草稿；保留 prerelease=true，不将其设为正式 latest，不改动历史 v0.4.0。

本次浏览器/设备/性能 H01—H04 尚未执行，Release 必须明确说明。Node DOM、注入驱动及静态构建不是实际游玩或设备兼容性证据；[验收清单](../../tasks/acceptance.md) 保留剩余人工项。完整参考游戏和文档已提供，不表示所有设备或生产场景验收完成。

GitHub Release 与 npm 是不同交付渠道。未来若授权 npm 发布，按 [npm 发布手册](npm-publishing.md) 处理，不能因为 GitHub 发布而宣称 npm 已更新。

## 文档维护范围

README 和开发手册提供当前源码/套件的使用路径；旧根入口手册描述历史布局。CHANGELOG 记录用户可见行为，验证记录区分实际检查与未覆盖项。现有 0.4.0 标签和附件用于重建历史版本，不重写成新 application 模型。
