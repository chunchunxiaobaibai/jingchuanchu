# 上传 GitHub

当前仓库已有 Git 历史与 0.3.0 发行标签，尚未关联远端。无需再次 git init。本说明是操作文档，本次整理没有创建 GitHub 仓库或推送。

## 文件范围

提交 packages、scripts、tests、docs、distribution、templates、examples，以及根 README、LICENSE、CHANGELOG、package/lock、TS 与格式配置。

archive/legacy-demos 和 archive/history 保留历史源码与记录，可一起提交；它们不参与当前引擎构建。archive/artifacts、node_modules、dist、测试报告及 .npmrc 已忽略。发布包与交付归档适合放 GitHub Release 附件，源码仓库保留生成方式。

## 首次关联与上传

先在自己的 GitHub 账号创建空仓库；已有本地 README/LICENSE 时，创建页面不要另生成初始提交。复制仓库真实地址。

在本项目的 WSL 目录执行：

```bash
cd /mnt/d/codexproject/xiaobaifqy-engine
git status --short
git remote -v
```

检查差异和暂存内容，确保只有预期源码及文档。提交本次整理后，用真实 URL 替换下面占位符：

```bash
git remote add origin <你的GitHub仓库URL>
git push -u origin HEAD
git push origin v0.3.0
```

`<...>` 是占位文字，不能直接复制执行。若已有 origin，先确认地址；无需再次 add，也不要未经核对就覆盖远端。GitHub 的认证与 npm 登录是两套独立流程。

v0.3.0 指向首次公开发行源码，当前目录整理位于其后的提交。不要移动该标签；后续新发行版使用新标签。

## 上传后

确认网页显示中文 README、MIT、开发文档与 8 个包目录。再将实际仓库 URL 写入根包和子包的 repository/homepage/bugs 字段，以便下一次 npm 发布显示源码与问题反馈入口。

当前没有自动 npm 发布工作流，推送 GitHub 不会重新上传 0.3.0。首次维护采用 [手动 npm 发布流程](npm-publishing.md)，后续再讨论 CI 与 trusted publishing。

参考：[GitHub 导入本地仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/adding-locally-hosted-code-to-github)。
