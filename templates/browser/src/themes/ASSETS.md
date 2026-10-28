# 参考游戏主题素材

此目录六份 SVG 均为本项目新绘制的简单几何图形，没有外部图片、字体、商标或下载素材。版权为 `Copyright (c) 2026 Xiaobaifqy Engine contributors`，按本目录 [MIT 许可](../../public/theme-assets-license.txt) 的 MIT 条款提供，可修改和商业使用，分发时保留许可与版权声明。public/theme-assets-license.txt 会随 Vite 静态构建复制到输出目录。

| 文件                            | 语义键           | 固有尺寸 / 使用区域          |
| ------------------------------- | ---------------- | ---------------------------- |
| default/assets/pause.svg        | ui.pause         | 24×24                        |
| default/assets/settings.svg     | ui.settings      | 24×24                        |
| default/assets/collectibles.svg | game.collectible | 图集48×24，使用左侧24×24区域 |
| dusk/assets/pause.svg           | ui.pause         | 24×24                        |
| dusk/assets/settings.svg        | ui.settings      | 24×24                        |
| dusk/assets/star.svg            | game.collectible | 普通图片24×24                |

`DefaultTheme` 声明稳定语义键，`DuskTheme` 通过 `extendTheme` 整体覆盖资源。图集到普通图替换不会继承旧 frame。路径由 `new URL(..., import.meta.url)` 交给 Vite 打包，不能手拼构建产物地址。显示尺寸与碰撞数据由页面/场景决定，不随源图片大小变化。

主题仅由开发者在应用装配时选择；没有玩家上传或运行时换肤入口。暂停/设置控件和道具场景共用这些映射；真实浏览器显示仍应按目标设备验收。
