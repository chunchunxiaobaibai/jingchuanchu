# asset-loading：分组资源加载与持有

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/assets.ts；复用现有 AssetCache 的并发合并、retain/release 和取消，不重新造无所有权的全局缓存。

## 契约

defineAssetGroup({name, entries}) 定义静态资源组。entries 用逻辑键声明 image、atlas、audio 或 json；路径来自构建导入的 URL，JSON 必须提供 parse/decoder。图集数据与图片关联，frame 有明确的像素范围。

context.assets.load(group, {signal, onProgress}) 返回 Promise<AssetGroupLease>。lease 提供受键/类型检查的资源读取及 release；owner 退出自动 release。错误带组名、资源键、URL 和 cause。可选资源必须显式声明，必需资源失败不得伪装整组成功。

加载并发默认限制为 4，可在应用配置调整。同一个解析键（种类＋URL＋decoder 身份）去重；组取消只释放自己的持有，不取消其他 owner 仍在使用的加载。晚到资源在没有持有者时释放一次。

progress 提供 total、completed、failed 与 pending 数，分母固定为本次选中条目数；表示条目进度，不伪称真实字节下载百分比。状态区分 idle/loading/ready/failed/cancelled；业务可以重新发起失败资源的加载，不无限后台重试。

第一阶段不做资源转码、自动图集打包或远程 CDN 管理。图片解码、音频字节加载、JSON 校验由注入适配器完成；Node 测试不依赖真实 Canvas 或音频设备。

## 直接验收

L1：并发上限、同键加载合并、固定条目进度和失败来源正确。

L2：两个 owner 共用同一图片，其中一个取消不破坏另一个；最后释放及晚到加载只回收一次。

L3：坏 JSON 不能进入已准备数据；重试仅重建失败条目，旧组取消不写回新组。

测试：tests/asset-groups.test.ts。图片解码和跨域获取的真实浏览器行为另列人工范围。
