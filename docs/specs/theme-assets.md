# theme-assets：主题与语义资源

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/theme.ts；依赖 asset-loading、reactive-core。主题不依赖 Router，也不包含游戏规则。

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

app-config 选择开发者主题；应用 ThemeService 提供只读 token、键解析和按 Scope 获取的 image lease。公共图标组件用资源键取 URL；Canvas 用同一解析规则取加载图片/图集 frame。两者不能各维护一份资源路径表，也不能把 CanvasImageSource 存进展示 Store。

token 只作用于应用根范围的 CSS 变量，组件 CSS/Less 负责布局。资源原始尺寸与显示尺寸、对齐、裁切分离；替换图片不改变实体逻辑尺寸、碰撞或规则。

路径/键/描述错误在构建或类型阶段定位；可加载覆盖失败时尝试对应默认资源并报告来源。默认也失败则呈现明确缺失状态，由页面决定重试，不无限请求。

第一阶段只提供构建时选择主题，不提供运行时上传或皮肤保存 UI。未来来源适配经资源解析层进入，不把路径拼接分散在业务组件中。普通直接图片引用允许存在，但不承诺自动加入换肤。

## 直接验收

T1：单改主题映射同时替换 DOM 暂停图标和 Canvas 道具图标，游戏逻辑/命中范围不变。

T2：未覆盖回退、覆盖加载失败回退、图集到单图替换及 owner 释放正确。

T3：两个应用不同主题互不污染；无效键在模板/类型检查定位。

测试：tests/themes.test.ts、主题编译 fixture。当前阶段不宣称已支持玩家上传、在线切肤或主题市场。
