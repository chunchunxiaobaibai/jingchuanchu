# GitHub 源码与本地套件交付

仓库：[chunchunxiaobaibai/jingchuanchu](https://github.com/chunchunxiaobaibai/jingchuanchu)。当前版本号为 0.4.0，交付方式为 GitHub 源码与预构建 Release 套件；暂不发布 npm 0.4.0。

[v0.4.0 下载入口](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.4.0)提供 ZIP、tar.gz 及对应 SHA-256 文件，游戏开发者可以直接解压使用，无需构建引擎。

## 源码更新与版本状态

上传 main 表示保存该提交的源码，不等于创建版本标签、GitHub Release 或更新 npm。开发阶段继续维护版本号与 CHANGELOG；不要仅因上传源码就把所有“npm 未发布”描述改成“已发布”。

上传前查看 git status 和待提交 diff，特别留意已有删除及未跟踪文件。工作区的未提交内容不会随普通 git push 上传；本地可运行也不能证明远端已经包含相同内容。

README 应优先提供“克隆 → npm ci → dist:release → CLI 创建游戏”的路径。GitHub 自动生成的 Source code 压缩包通常只包含被 Git 跟踪的源码，本仓库忽略的 dist 和 tgz 不在其中。下载源码后仍需构建；不能直接把 templates/browser 当成已经配置好的独立发行模板。

## 可选的 Release 附件

仅更新源码时不需要创建 Release。如果要让游戏开发者免去引擎构建步骤，可以另行创建明确版本的 GitHub Release，并上传：

```text
jingchuanchu-engine-0.4.0.tar.gz
jingchuanchu-engine-0.4.0.tar.gz.sha256
```

文件由 npm run dist:release 生成，包含 10 个本地 tgz、清单、安装器、模板及开发手册。GitHub Release 不要求同时发布 npm，也不需要把生成产物提交到源码历史。

创建正式版本时，先完成所需检查并提交源码，再创建与根版本一致、尚未使用的标签，例如 v0.4.0。若已经生成并验证 tgz，可在干净提交及标签处运行 `npx tsx scripts/distribution/build.ts`，让套件记录最终 revision；检查 manifest.json 的 sourceDirty 为 false，sourceTag 与标签一致。不要移动已有版本标签或在同一版本下悄悄替换不同内容。

Release 说明应写明新增能力、兼容性、使用入口和实际验证范围。浏览器交互未验证时如实注明；不要用静态构建结果替代浏览器或设备兼容性结论。

## 文档维护范围

- README：当前交付状态、源码快速开始、模块导航、许可和反馈入口。
- 开发手册：本地套件使用、创建项目、生成组件/场景、生命周期及主动迁移。
- CHANGELOG：对使用者可见的变更；GitHub 源码状态与 npm 发布状态分开记录。
- [验证记录](../validation.md)：实际执行的命令、环境与未验证部分。
- [贡献指南](https://github.com/chunchunxiaobaibai/jingchuanchu/blob/main/CONTRIBUTING.md)：复现信息、修改边界和按需验证方式。

完整资料已在仓库内，不必重复维护第二套 Wiki。后续决定发布 npm 时再执行 [npm 发布手册](npm-publishing.md)，并同步更新版本与页面说明。
