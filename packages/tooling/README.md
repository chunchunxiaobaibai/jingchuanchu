# @xiaobaibaifqy/jingchuanchu-tooling

镜川初开发工具：三文件编译、模板类型诊断、CSS/Less 作用域和 CLI。放在 devDependencies；引擎核心运行包不依赖工具链。需要与当前 application 模型配套的包，历史同版本号不能代替构建来源。

## 配置 Vite

```ts
import { defineConfig } from 'vite';
import { jingchuanchu } from '@xiaobaibaifqy/jingchuanchu-tooling/vite';
export default defineConfig({ plugins: [jingchuanchu()] });
```

CLI 创建的项目已包含插件、check/build/generate 命令与项目配置。插件不固定 dev/preview 端口，以 Vite 输出为准。三文件资源变更会整页重载，不保留旧实例或内存状态。

## 创建和生成

已有配套套件时，在安装 tooling 的目录使用：

```bash
npx --no-install jingchuanchu create ./my-game --preset singleplayer --style css --bundle /path/to/bundle
cd my-game
npm install
npm run generate -- page bonus --route /bonus
npm run generate -- component score-panel --page bonus
npm run generate -- component icon-button --shared
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme forest --extends default
npm run check
```

| 项目/命令                            | 行为                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| create singleplayer/client           | 默认 schemaVersion:2、profile:application，复制完整参考游戏；client 额外提供 net，不连接后端 |
| create --style less                  | 同名 Less 三文件，保留媒体与许可                                                             |
| create core/server                   | 无 UI 预设，使用相应入口                                                                     |
| create --profile legacy-v0.4         | 显式旧浏览器模板                                                                             |
| generate page --route                | 创建页面并向可静态分析的 app-routes.ts 注册懒路由                                            |
| generate component --page / --shared | 页面私有 / 共享组件，只生成文件，父级显式引用                                                |
| generate scene --page                | 场景放页面旁，显式传给 GameCanvas，不自动启动                                                |
| generate store --domain              | 生成到游戏域，通过 context.useStore 使用                                                     |
| generate theme [--extends]           | 创建/派生主题，AppConfig 显式选择                                                            |
| check [directory]                    | 目录边界、三文件资源与模板检查；完整项目 check 再执行 tsc                                    |

参考模板已有 play、game、default 等名称，使用新名称扩展。现代 profile 不接受 generate view 或旧 --parent 注册；legacy profile 才使用旧 view/scene 自动注册。--project 明确指定项目根，CLI 不向父目录猜配置。

## 配置与依赖安装

jingchuanchu.json 的 schemaVersion:2/profile:application 声明新模型。paths 可配置 app/pages/game/components/themes/account，默认在 src 下；使用项目内的小写 kebab-case 路径，不重叠、不越界。改变配置不自动迁移文件。无配置或旧版本配置按 legacy 识别，不能只改 profile 完成迁移。

```bash
npx --no-install jingchuanchu add --modules assets,net --bundle /path/to/bundle --project ./my-game
# 或选择整个套件（包含 net-server 等全部运行包）：
npx --no-install jingchuanchu add --all --bundle /path/to/bundle --project ./my-game
cd my-game
npm install
npm run check
```

create/add --bundle 预先验证 manifest、所选包 SHA-256 和内部依赖闭包，复制到 vendor 并写相对 file 依赖。add 将 tooling 放 devDependencies，其他包放 dependencies；记录到 jingchuanchu-packages.json。可重用相同字节附件，拒绝覆盖同名不同字节文件；失败回滚本次写入，保留无关业务。

这些命令不运行 npm install、不更新锁文件或启动服务。离线安装还要求外部开发依赖已缓存。若同版本号源码快照与附件内容不同时，优先创建新项目并迁移业务，不能把同名新 tgz 覆盖进旧 vendor 后假定缓存已更新。

## 编译规则

工厂从 app/application 具名导入 defineComponent/definePage，定义赋给变量，元数据对象不使用动态 spread。自动关联同名 HTML 与可选 CSS/Less，或指定静态 templateUrl/styleUrl；同名 CSS/Less 歧义需要解决。模板检查原生 property、输入/输出、表达式与 model 可写性，错误映射到原 HTML 的位置。

现代绑定为插值、:property、@event、model:name、template when/each、slot。不解释任意脚本或 HTML。TS 中 camelCase 字段在模板用 kebab-case。旧 defineView 的 data-* 管线保持原契约。

Less 先编译相对导入，再对选择器加作用域并重命名动画；:global/:root/:host 等逃逸被拒绝。全局基础样式从 main.ts 导入，主题变量由应用配置安装。CSS URL 和依赖交给 Vite，TS 与样式提供 source map。不要手写编译器拥有的 $template/$bindings 元数据。

配套套件 docs/development 中包含 application-framework.md、application-components.md、application-gameplay.md、application-services.md 和 application-api.md。MIT，见 LICENSE。
