# @xiaobaibaifqy/jingchuanchu-app

镜川初网页 2D 应用运行时。当前源码新增 `@xiaobaibaifqy/jingchuanchu-app/application` 子入口，提供组件/页面、响应式、Store、路由、资源/主题、GameCanvas、音频、存档和可选账号权限。旧根入口 defineGame/defineView/defineInput 等保留原契约，两个入口不混用模板语法。

当前预发布版本为 0.5.0-rc.1。新能力需要从包含 application 的源码构建的配套包；历史同版本附件不自动获得该入口。使用配套 tooling 生成项目并编译三文件定义；原始 defineComponent 不能脱离模板编译直接挂载。

## 最小应用

已有配套引擎包和 tooling/Vite 配置时，创建 src/app/app-shell.ts：

```ts
import { defineComponent, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const AppShell = defineComponent({
  selector: 'game-app',
  setup() {
    const count = signal(0);
    return { count, increment: () => count.update((value) => value + 1) };
  },
});
```

同目录 app-shell.html：

```html
<main>
  <p>得分：{{ count }}</p>
  <button type="button" @click="increment()">增加</button>
</main>
```

src/main.ts：

```ts
import {
  defineApplication,
  bootstrapApplication,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppShell } from './app/app-shell.js';
const app = await bootstrapApplication(defineApplication({ root: AppShell }));
// 离开整个应用宿主时调用 app.dispose()。
```

index.html 提供一个 game-app 宿主和指向 /src/main.ts 的 module script。组件样式写同名 CSS 或 Less，Vite 插件从 tooling/vite 导入。实际参考模板还有页面、Store 和服务；不要把上面的最小示例当作对已有完整项目的整份覆盖。

## 常用能力

| 能力           | 入口                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| 状态和表单     | signal/computed/effect/batch/nextTick、input/output/model/writableModel             |
| 组件和应用     | defineComponent/definePage、defineApplication/mountApplication/bootstrapApplication |
| 跨页状态/服务  | defineStore、defineService/provideService、context.useStore/useService              |
| 页面导航       | defineRoutes、RouterOutlet/RouteLink、context.router                                |
| 图片/数据/主题 | defineAssetGroup、context.assets.load、defineTheme/extendTheme                      |
| 页面内游戏     | defineGameScene/defineActions、GameCanvas、createGameClock                          |
| 声音           | 配置 assets + audio.driver，context.audio/scene.audio                               |
| 保存和恢复     | defineSave、SaveService、StorageAdapter                                             |
| 可选账号/权限  | AuthService/AccessService、createAccessGuard/bindAccessRouter                       |

setup 返回要暴露给模板的成员；signal/computed 自动解包，普通操作函数只在调用表达式中执行。对象 state 是普通数据快照，通过 set/update 替换；场景定义、驱动等函数能力只能用显式 reference input，不能放入普通 signal/props。生命周期与 effect 同步，异步业务使用事件操作/取消信号或 Store.runTask。

GameCanvas 显式注册后使用，需要有 CSS 尺寸的宿主；它统一管理所属帧、输入和场景，离页释放。assets/audio/theme 需应用显式配置，未配置时访问对应上下文会报错。音频 unlock 从真实手势同步进入，存档只保存显式字段且由业务恢复。

## 旧入口兼容与文档

旧根入口仍用 defineView 的 data-text/data-attr-_/data-on-_/data-ref、defineGame 和 bootstrapGame；新入口用三文件 setup、{{...}}、:property、@event 和 model。新 CLI 默认生成 application，旧布局须 --profile legacy-v0.4；迁移按页面进行，不靠改导入或 profile 自动转换。

配套套件中的 docs/development/README.md 是文档入口；application-components.md、application-gameplay.md、application-services.md 提供使用教程，application-api.md 提供 API 索引。历史根入口见 application-suite.md。源码仓库：[Jingchuanchu](https://github.com/chunchunxiaobaibai/jingchuanchu)。

Node DOM/注入驱动检查不等于实际浏览器、设备音频或性能验收。MIT，见 LICENSE。
