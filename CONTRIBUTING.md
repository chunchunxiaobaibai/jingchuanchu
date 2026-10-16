# 参与镜川初开发

当前通过 GitHub 交付源码及可自行生成的本地分发套件，暂不发布 npm 0.4.0。先阅读 [README](README.md)、[项目约定](AGENTS.md) 和 [架构说明](docs/architecture.md)。

## 反馈问题

通过 [Issues](https://github.com/chunchunxiaobaibai/jingchuanchu/issues) 提交问题或功能建议。问题报告请包含：

- Git 提交号或所用分发版本、Node/npm 版本及操作系统；说明使用 Windows 还是 WSL。
- 最小复现步骤、期望行为和实际结果。
- 相关报错；涉及页面时补充浏览器版本和实际操作。

使用 app/tooling 时，请注明创建预设、CSS/Less 选择，以及依赖来自 vendor、本地 tgz 还是公共 npm。不要附上认证信息或个人环境文件。

## 修改和验证

```bash
git clone https://github.com/chunchunxiaobaibai/jingchuanchu.git
cd jingchuanchu
npm ci
```

保持既有函数名、包名和公开入口，通过新增接口或可选参数扩展。玩法放在独立游戏中；核心包不反向依赖应用套件或开发工具。性能改进需提供同环境测量，不能把 Node 模拟绘制当成浏览器帧率。

按改动选择必要检查：

| 改动                   | 针对性检查                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| TS 源码或类型          | `npm run typecheck` 与相关测试文件                                 |
| app/tooling            | `npm run test:app`                                                 |
| 模板和项目结构         | `npm run check:templates`、`npm run test:project`                  |
| 包公开名称或入口       | `npm run test:api`                                                 |
| 本地套件和代码生成交付 | `npm run dist:release`，再按需执行 `npm run test:app:distribution` |
| 仅文档                 | 检查 Markdown 格式、相对链接和示例与源码的一致性，无需新增测试     |

不默认运行全套测试、分发验证或浏览器测试。不要自动启动 Chromium、Playwright、页面操作或截图；需要浏览器验证时由维护者明确安排。提交说明应如实列出执行的检查与尚未验证的部分。

## 提交变更

围绕一个问题提交修改，说明触发条件、修改后的行为、兼容性及验证结果。新增能力同步更新相关开发手册；修复具体缺陷时增加直接回归，避免无关重构和重复实现逻辑的测试。

提交源码、文档和必要锁文件；node_modules、dist、tgz 和个人环境文件不放入 Git 历史。发行套件可由维护者作为 GitHub Release 附件提供。

贡献遵循仓库的 [MIT 许可证](LICENSE)。合并代码、创建 Release 和 npm 发布分别由维护者决定，贡献提交不自动触发这些操作。
