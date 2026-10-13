# 镜川初 · Jingchuanchu Engine · {{VERSION}}

这是可以交给其他开发者使用的分发套件，采用 MIT 授权。无需克隆引擎仓库。

## 最快开始

需要 Node >=22.12 和 npm。保留解压后的目录结构：

```bash
cd starters/browser
npm install
npm run dev
```

访问 http://localhost:5175 。修改 src/game.ts 制作自己的游戏；npm run build 输出可静态托管的网页。

## 接入现有项目

在自己的项目目录运行：

```bash
node /path/to/this-bundle/install.mjs --preset singleplayer
```

可用预设：core、singleplayer、client、server。选择部分模块：

```bash
node /path/to/this-bundle/install.mjs --modules core,assets --target ./my-game
```

安装器检查所选 tgz 的 SHA-256，自动补齐内部依赖。--dry-run 只检查和列出包；--offline 要求外部依赖已缓存。
完整仓库的开发条件 source 不需要添加到你的项目配置。默认消费编译后的 ESM 与 .d.ts。

## 开发文档与示例

- [开发手册](docs/development/README.md)
- [快速入门](docs/development/getting-started.md)
- [API 参考](docs/development/api-reference.md)
- [联网接入](docs/development/networking.md)
- [版本记录](CHANGELOG.md)
- [MIT LICENSE](LICENSE)

examples/network 可单独安装并启动 ping 服务；其他 examples 展示内核、自定义模块与资源缓存。
只有 net-server 的运行依赖包含 ws；没有把你画我猜或 Zod 打进引擎包。

## 分享与保存

可把本目录或对应 tar.gz 交付给其他人。manifest.json 和 SHA256SUMS 记录安装包版本与内容校验值。
本地 file 依赖需要保留 tgz。迁移项目时一起保存安装包，或配置自己的 registry。
公共包统一命名为 @xiaobaibaifqy/jingchuanchu-*；本地安装器只使用随归档提供的对应版本。
