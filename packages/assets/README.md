# @xiaobaibaifqy/jingchuanchu-assets

Promise 资源缓存、共享加载、失败重试与释放。/module 提供 assetModule。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-assets
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { AssetCache } from '@xiaobaibaifqy/jingchuanchu-assets';
const cache = new AssetCache(async (url: string) => ({ url }));
const asset = await cache.get('level-1');
console.log(asset.url);
cache.dispose();
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

新增 `getStatus(url)`、`delete(url)`、`retain(url)`。retain 返回 `{ promise, release }`，clear 保留正在持有的资源，dispose 强制取消并清理。load 可接收第二个 CancellationSignal（非原生 AbortSignal），旧单参数函数仍可使用。释放异常可通过 releaseErrors 或 onReleaseError 观察。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

## 授权

MIT，见 [LICENSE](LICENSE)。
