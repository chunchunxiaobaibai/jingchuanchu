# theme-assets：主题与语义资源

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/theme.ts；依赖 asset-loading、reactive-core。主题不依赖 Router，也不包含游戏规则。

实现进度：T19 自动项已通过：主题定义/覆盖、应用 CSS token/类型化契约解析、owner-bound image lease、实际图集尺寸验证及覆盖失败的默认回退。验证使用 Node DOM 和注入图片源，不代表真实浏览器/CSS 布局/Canvas 画面已验收。

## 定义

```ts
const defaultTheme = defineTheme({
  name: 'default',
  tokens: { accent: '#176b58' },
  assets: {
    'ui.pause': { kind: 'image', src: pauseImage },
    'game.coin': {
      kind: 'atlas-region',
      src: atlasImage,
      frame: { x: 0, y: 0, width: 16, height: 16 },
    },
  },
});
const forestTheme = extendTheme(defaultTheme, {
  name: 'forest',
  assets: { 'game.coin': { kind: 'image', src: coinImage } },
});
```

资源键由游戏声明并由默认主题推导，覆盖键与类型可检查。image 与 atlas-region 使用区分联合；覆盖单个资源时整体替换描述，不能把旧 frame 偷合并到新图片。未覆盖的键/样式 token 回退默认定义；不做任意深层对象合并。

token 值限 string 或有限 number，键使用 CSS 标识符（字母/下划线开头，后接字母/数字/下划线/短横线），根作用域变量名固定为 `--jcc-${key}`。extendTheme 只允许既有 token/资源键，token 保留 string/number 类别但不锁死默认字面量。多级派生继承上一层未覆盖值，资源 defaultAssets 始终保存最初默认映射，供覆盖加载失败时回退；定义快照不受外部对象修改影响。此阶段不提供运行时 setTheme 或上传入口。

app-config 选择开发者主题；应用 ThemeService 提供只读 token、键解析和按 Scope 获取的 image lease。公共图标组件用资源键取 URL；Canvas 用同一解析规则取加载图片/图集 frame。两者不能各维护一份资源路径表，也不能把 CanvasImageSource 存进展示 Store。

通过 `context.useTheme(defaultTheme)` 或 `app.useTheme(defaultTheme)` 绑定默认契约，得到带精确 token/资源键的上下文：只读 name/tokens，以及 resolve(key)。返回应用所选派生主题，默认契约须与其共享原始 defaultAssets 表，避免混入另一主题族。模板可在 setup 暴露绑定后的 resolve 函数，从而检查字面量资源键。上下文绑定调用 owner，退出后不能继续解析；未配置主题明确报缺失。应用 theme 选择只在挂载时完成，没有运行时切换入口。

根宿主只安装主题自有 `--jcc-*` 变量；退出/启动失败按变量恢复原值与 priority，保留不属于主题的样式变化，不写 documentElement。资源描述解析不会自动下载图片；需要实际资源时使用下方 owner-bound load，底层由注入 assets transport 解码和释放。

`theme.load(key,{signal?})` 返回 ThemeImageLease：kind/asset、image、图集时的 frame、fallback、可选 diagnostic 与 release。DOM 可用 asset.src 和 frame，Canvas 用同一 image.source/frame；图片、实际图集尺寸验证与持有均复用当前 owner 的 assets。image/frame 读取在释放后报错。覆盖失败仅尝试一次最初 defaultAssets，回退成功的 lease 保留原 ThemeError diagnostic；配置了应用 onError 时也报告该来源。无观察器不额外制造未捕获异常。默认也失败则拒绝包含两个原因的 ThemeError；取消/owner 退出不触发默认回退。该操作不改变 resolve 的静态映射，成功后的实际资源来源以 lease.asset 为准。

token 只作用于应用根范围的 CSS 变量，组件 CSS/Less 负责布局。资源原始尺寸与显示尺寸、对齐、裁切分离；替换图片不改变实体逻辑尺寸、碰撞或规则。

路径/键/描述错误在构建或类型阶段定位；可加载覆盖失败时尝试对应默认资源并报告来源。默认也失败则呈现明确缺失状态，由页面决定重试，不无限请求。

第一阶段只提供构建时选择主题，不提供运行时上传或皮肤保存 UI。未来来源适配经资源解析层进入，不把路径拼接分散在业务组件中。普通直接图片引用允许存在，但不承诺自动加入换肤。

## 直接验收

T1：单改主题映射同时替换 DOM 暂停图标和 Canvas 道具图标，游戏逻辑/命中范围不变。

T2：未覆盖回退、覆盖加载失败回退、图集到单图替换及 owner 释放正确。

T3：两个应用不同主题互不污染；无效键在模板/类型检查定位。

测试：tests/themes.test.ts、主题编译 fixture。当前阶段不宣称已支持玩家上传、在线切肤或主题市场。
