# @xiaobaibaifqy/jingchuanchu-tooling

镜川初开发工具：三文件组件编译、CSS/Less 隔离和项目/代码生成。作为项目 devDependency 使用；核心引擎运行包不依赖本工具。

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { jingchuanchu } from '@xiaobaibaifqy/jingchuanchu-tooling/vite';
export default defineConfig({ plugins: [jingchuanchu()] });
```

```bash
jingchuanchu create ./my-game --preset singleplayer --style less --bundle /path/to/jingchuanchu-engine-0.4.0
jingchuanchu generate view score-panel --project ./my-game
jingchuanchu generate scene menu --project ./my-game
jingchuanchu check ./my-game
```

create 支持 core、singleplayer、client、server。默认不安装依赖、不启动服务；创建后运行 npm install、npm run check、npm run build。本地 --bundle 会先校验选定包及传递依赖的 SHA-256，再复制到 vendor 并写相对 file: 依赖；保留 vendor 即可迁移。省略 --bundle 使用版本依赖，须先确保所需版本已发布，目前新套件应使用本地分发。

generate view 自动生成同名 TS/HTML/CSS 或 Less，加入父 components 并插入父模板；默认父组件为 src/ui/components/GameApp/GameApp.ts，--parent 可指定其他父组件。generate scene 自动加入 src/app/game.ts 的 scenes，保留当前 initialScene。注册目标须使用静态 defineView/defineGame 对象和数组；生成器拒绝覆盖已有文件。

组件默认采用同目录同名模板与可选 CSS/Less；可用静态 templateUrl/styleUrl 指定其他位置。资源缺失、CSS/Less 歧义和未知绑定名在 check/build 阶段报错。Less 先编译，正常相对 import 可用；随后为每个选择器片段添加组件标记、重命名动画，阻止 :global/:root/:host 和全局 at-rule。全局主题由 main.ts 导入。只约束样式向外传播，不阻断继承属性。

配套文件和 Less/CSS 导入参与 Vite 监听；变更通过整页重载重建应用，不保留旧组件实例。CSS 以内联资源交给 Vite 处理 URL，TS 和 Less/CSS 提供 source map。插件依据 Vite 7 的 transform/addWatchFile/handleHotUpdate 契约实现。

本地 0.4.0 尚未发布 npm。MIT，见 LICENSE。
