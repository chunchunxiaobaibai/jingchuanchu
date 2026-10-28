# asset-loading：分组资源加载与持有

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/assets.ts；复用现有 AssetCache 的并发合并、retain/release 和取消，不重新造无所有权的全局缓存。

实现进度：T17/T18 自动项已通过：资源描述/decoder、共享并发池、条目进度、lease/取消/晚到回收、应用 assets 配置与 owner-bound context.assets.load、同 owner 失败重试。实际传输由同步工厂注入，不隐式创建浏览器适配器。Node 使用注入源和尺寸验证，不代表真实图片/音频解码通过。

## 契约

defineAssetGroup({name, entries}) 定义静态资源组。entries 用逻辑键声明 image、atlas、audio 或 json；路径来自构建导入的 URL，JSON 必须提供 parse/decoder。图集数据与图片关联，frame 有明确的像素范围。

首个描述契约：image/audio 为 `{kind,url,optional?}`；json 另需同步 `parse(unknown)`，结果必须是可快照的纯数据；atlas 的 url 指图片，frames 为显式静态像素矩形 `{x,y,width,height}` 表。定义时验证整数/正尺寸并冻结 frame 快照，解码后再按实际图片尺寸验证越界。远程图集元数据可由业务构建阶段转换为上述帧表，当前不新增第二条隐式元数据请求。图片值为 `{source:CanvasImageSource,width,height}`，图集值为 `{image,frames}`，音频值为 ArrayBuffer，JSON 值为 decoder 返回类型的深只读快照。类型定义不代表已接入宿主图片/音频解码器。

context.assets.load(group, {signal, onProgress}) 返回 Promise<AssetGroupLease>。lease 提供受键/类型检查的资源读取及 release；owner 退出自动 release。错误带组名、资源键、URL 和 cause。可选资源必须显式声明，必需资源失败不得伪装整组成功。

lease.get(key) 读取资源，release 幂等，释放后读取会抛带来源的 AssetError。加载期 signal 取消或提前 release 会立即拒绝等待（operation:'cancel'），不等待不响应取消的适配器；仅释放当前批次 retain，不影响其他持有者。成功后 signal 取消也释放本次 lease。取消进度保留已成功/失败计数，pending 表示尚未结算条目，状态为 cancelled；晚到结算不再通知该批次或写入其值表。传输无法强制中止时，晚到 raw 由加载器回收一次。owner/应用装配已接入；放弃失败批次时可取消当次 signal，或随 owner 退出统一释放。

应用通过 `assets: {transport: () => AssetTransport, concurrency?: number}` 注入适配器，每次挂载创建独立加载器；工厂同步返回端口，不隐式使用浏览器全局。`context.assets` 绑定当前组件/页面 owner，`app.assets` 绑定应用 owner；未配置时 app.assets 为 undefined，组件访问缺失上下文明确报错。成功 lease 与失败批次成功项都受 owner 管理，退出统一释放。失败后同 owner/同 group 再次 load：先为新批次 retain，再释放旧失败批次，因此仅重载失败项；取消批次不保留局部结果。独立成功 lease 互不替换，无无限自动重试。此步骤不提供默认真实图片/音频适配器；端口需要在业务或后续宿主适配中注入。

加载并发默认限制为 4，可在应用配置调整。同一个解析键（种类＋URL＋decoder 身份）去重；组取消只释放自己的持有，不取消其他 owner 仍在使用的加载。晚到资源在没有持有者时释放一次。

内部传输端口 `AssetTransport.load(entry, signal)` 返回待解码值；image/atlas 返回图片源与尺寸，audio 返回 ArrayBuffer，json 返回 unknown 交由 entry.parse。可选 release(entry, raw) 回收原始传输值，解码失败也回收已取得的原始值。图集的静态帧表内容纳入解析键，避免相同图片 URL 的不同帧定义混用。并发上限作用于同一加载器的所有组，不按组各开一个池。T17 的内部批次提供 ready/release 供回收验证，T18 已让内部 ready 返回类型化 lease 并接入 signal 取消；公开 owner/context 入口仍待装配。

条目进度中 completed 仅计成功项，failed 计失败项，始终 completed+failed+pending=total；可选项失败仍计 failed，但必需项均成功时组可 ready。必需项错误使 ready 拒绝，批次仍须 release；内部批次保持成功项持有，便于后续受控重试。进度观察器必须同步；抛错或返回 Promise 记为该组 progress 错误，异步拒绝会被消费，不影响其他组/条目继续结算。

progress 提供 total、completed、failed 与 pending 数，分母固定为本次选中条目数；表示条目进度，不伪称真实字节下载百分比。状态区分 idle/loading/ready/failed/cancelled；业务可用 idle 初始化展示，onProgress 从实际加载的 loading 开始；业务可以重新发起失败资源的加载，不无限后台重试。

第一阶段不做资源转码、自动图集打包或远程 CDN 管理。图片解码、音频字节加载、JSON 校验由注入适配器完成；Node 测试不依赖真实 Canvas 或音频设备。

## 直接验收

L1：并发上限、同键加载合并、固定条目进度和失败来源正确。

L2：两个 owner 共用同一图片，其中一个取消不破坏另一个；最后释放及晚到加载只回收一次。

L3：坏 JSON 不能进入已准备数据；重试仅重建失败条目，旧组取消不写回新组。

测试：tests/asset-groups.test.ts。图片解码和跨域获取的真实浏览器行为另列人工范围。
