# @xiaobaibaifqy/jingchuanchu-input

键盘与指针输入。/module 提供 keyboardModule、pointerModule 和 Keyboard 服务 token。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-input
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { KeyboardInput } from '@xiaobaibaifqy/jingchuanchu-input';
const scope = new Scope();
const input = new KeyboardInput(window, ['ArrowLeft', 'ArrowRight']);
scope.own(() => input.dispose());
console.log(input.isDown('ArrowRight'));
scope.dispose();
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

原 KeyboardInput、bindPointer、keyboardModule 和 pointerModule 保留。配合场景管理时，把场景专用订阅登记到 SceneContext.scope，在退出时释放；共享输入由应用显式持有。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

## 授权

MIT，见 [LICENSE](LICENSE)。
