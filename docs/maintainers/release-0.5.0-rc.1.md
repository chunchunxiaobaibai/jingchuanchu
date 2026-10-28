# 镜川初 0.5.0-rc.1：网页 2D 应用框架预发布

本次通过 GitHub Release 交付，不发布 npm。该版本标记为 **Pre-release**：自动检查和独立静态构建不代表浏览器、设备音频或性能验收完成。原 v0.4.0 标签与附件保留。

## 下载与使用

在 Assets 下载 `jingchuanchu-engine-0.5.0-rc.1.zip`（Windows）或 `.tar.gz`，并按对应 `.sha256` 校验。两种归档内容相同，包含 10 个本地 tgz、清单/摘要、安装器、参考游戏、教程和 MIT 许可。GitHub 自动生成的 Source code 附件仅含源码，不含这些预构建包。

准备 Node.js >=22.12.0、npm，在解压目录执行：

```bash
cd starters/browser
npm install
npm run check
npm run build
npm run dev
```

访问 Vite 终端显示的地址；当前模板不固定端口。保留 starter 与 packages 的相对位置。需要独立项目时，按套件 docs/development/getting-started.md 使用配套 tooling 的 create --bundle，将引擎依赖复制到自己的 vendor。依赖安装仍需网络或已缓存的开发工具；无需 npm 登录。

在生成的独立项目中继续开发：

```bash
npm run generate -- page bonus --route /bonus
npm run generate -- component score-panel --page bonus
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme forest --extends default
```

页面生成会注册路由；组件、场景和主题由业务显式装配，不覆盖已有定义。构建后的游戏网页位于项目 dist。

## 新增与修复

- 独立 `@xiaobaibaifqy/jingchuanchu-app/application` 入口：细粒度响应式、三文件组件、input/output/model、Store/Service、页面路由和懒加载/预加载。
- 资源组、取消与租约，语义主题、图集/普通图替换与默认回退；页面所属 GameCanvas、视口/动作适配、固定步计时与缓动。
- 音频解锁/播放/音量与 owner 生命周期、白名单存档/版本迁移/命名空间；可选认证与权限通过 HTTP Provider 示例接入，默认单机不需要账号服务。
- 完整参考游戏：首页、选关、收集玩法、暂停/重开、设置、结算、进度与偏好保存，两套主题和原创音效。
- CLI 默认 application profile，支持 page/component/scene/store/theme、项目 paths 和 vendor 安装；旧布局通过 `--profile legacy-v0.4` 显式创建。
- 修复 computed 在使用方销毁后被共享 signal 强持有的问题，以及动态 select 选项与 model 初始不同步的问题。
- 补齐快速入门、组件/页面、2D 场景、资源/服务、API、迁移和排障文档。

## 兼容与验证边界

原包名、旧根入口 defineGame/defineView 等保留；新模型使用新增 application 子入口。旧模板的 data-* 语法与目录不自动迁移，不能只改 import/profile 就完成升级。使用同一套件内的所有配套引擎依赖，避免混装历史 0.4.0。

已完成 349 项 Node 用例验证（含匹配 Node/npm 环境后的定向重试）、严格类型/模板检查、10 包构建、CSS/Less/legacy 实际 tgz 消费、基础包独立消费、118 个旧 API 名称与 Node 分发检查。详细记录见套件 docs/validation.md，验收清单见 tasks/acceptance.md。真实浏览器游玩、输入法/触控/历史、设备音频/后台恢复和性能 H01—H04 尚未执行；本预发布不声明这些通过。DX01—DX03 的生命周期推断、内联 guard 推断及根引用输入限制仍有明确写法要求，见开发手册。

套件 manifest.json 记录版本、来源提交、标签与每个 tgz 的 SHA-256；SHA256SUMS 与外部 .sha256 分别校验包和归档。修改源码后必须重新构建才能进入 tgz/vendor，历史附件不会随仓库更新。
