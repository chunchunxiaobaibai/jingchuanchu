# 网页 2D 参考游戏

已提供首页昵称、选关、收集游戏、暂停/重开、设置、结算与白名单保存，以及两套开发者主题。声音素材、音频驱动、交互试听和收集/结算反馈已接入；CLI 默认创建项目使用此完整模板。Node DOM、注入驱动及静态构建通过，不代表真实浏览器/设备游玩验收完成。

入口为 src/main.ts；应用装配在 src/app；页面在 src/pages；共享规则和数据在 src/game。使用配套构建的引擎/工具后运行 npm run check、npm run build；历史同版本附件不能替代新入口。需要旧布局时，显式 create --profile legacy-v0.4 使用独立旧模板。

## 游玩和记录

首页确认昵称后进入 /levels，关卡数据由 src/game/session/levels.ts 定义。查看目标、选定关卡后开始 /play/:levelId。图片加载完成才创建 Canvas；失败可重试，离页释放加载和活动。方向键/WASD、点选或虚拟方向按钮移动，收集微光；Esc/HUD 暂停、继续和重开。暂停时可进入设置，离开未结束本局会结束该活动会话。

游玩结束后进入 /result 查看结算；选关页也提供旅程记录入口。结算显示本关结果、各关最高分与通关状态，可重开本关、返回选关/首页。“保存进度”才持久化，刷新后主动“读取进度”；读取与当前会话成绩合并，不降高分或清除通关标记。无本次结果时显示空状态，不恢复上次活动游戏。

## 设置和保存

/settings 提供昵称、主/音乐/音效音量和静音。“保存设置”保存有效昵称和声音偏好，未确认昵称也会在保存时应用；刷新后可主动“读取设置”。设置和进度各用独立记录，仅保存白名单，不含活动实体、画布或设备状态。默认使用 localStorage，可通过 GameStorage 的应用服务注册替换存储适配。

损坏、不兼容或存储不可用会提示并保留当前状态和原记录；读取期间编辑或离页不被晚到结果覆盖。当前自动验证用内存存储；真实 localStorage 未验收。默认配置惰性 Web Audio 驱动，进入页面不会创建或自动解锁 AudioContext。游戏页点击“启用并试听声音”后才尝试解锁和播放，明确显示设备受限、加载、失败、音效已启动及当前静音；这不承诺真实设备可听。声音偏好沿用设置页与保存记录。

## 开发者主题

默认 AppConfig.theme 选择 DefaultTheme。使用暮色主题时，在 src/app/app-config.ts 引入 src/themes/dusk/dusk-theme.ts 的 DuskTheme，并将 theme 设为 DuskTheme。组件与场景共用 ui.pause、ui.settings、game.collectible 资源键，无需逐页面修改图片路径。

DefaultTheme 的道具从图集裁切，DuskTheme 替换为普通 SVG；图片源尺寸不改变20×20道具显示/碰撞尺寸。src/themes/ASSETS.md 列出六份原创 SVG、尺寸与 MIT 许可；public/theme-assets-license.txt 随构建输出，分发时保留。换图修改主题资源映射，颜色修改 token，使用 new URL(..., import.meta.url) 交给 Vite 打包。没有玩家上传或运行时换肤入口。

三份短音效位于 src/assets/audio，ASSETS.md 记录原创合成公式、格式和MIT许可，仓库 scripts/generate-audio.mjs 可确定性重建；项目运行不需要重新生成。收集会触发场景音效和短脉冲，暂停冻结脉冲并停止场景音效；通关/超时提示音由仍活动的游戏页持有，重开或离页停止。未解锁不积压补播，声音失败不影响玩法。脉冲只改视觉尺寸，不改碰撞范围。

## 继续开发

```bash
npm install
npm run check
npm run build
npm run dev
npm run generate -- page bonus --route /bonus
npm run generate -- component score-panel --page bonus
npm run generate -- scene bonus --page bonus
npm run generate -- store score --domain session
npm run generate -- theme custom
npm run generate -- theme forest --extends custom
```

内置的 play 页、game Store 和 default 主题已经存在，新增业务使用其他名称。生成场景和主题后由业务显式装配，不自动启动场景或替换当前主题。client 预设增加 net 依赖，但不会自动连接后端。

## 项目命令与继续阅读

npm run dev 和 npm run preview 的地址以 Vite 输出为准，本模板未固定端口。需要固定开发端口可用 npm run dev -- --port 5175 --strictPort。app/app-config.ts 负责主题、资源/音频驱动和存储 Provider；app/app-routes.ts 负责命名路由与懒加载。

配套套件或源码仓库的 docs/development/README.md 是完整手册入口：application-components.md 提供可照写的三文件/Store/路由示例；application-gameplay.md 说明 GameCanvas、动作和计时；application-services.md 说明资源租约、JSON 传输扩展、音频与保存；application-api.md 提供公开 API 索引。

create --bundle 生成的独立项目保留 vendor 和锁文件；直接运行套件 starter 时保留与 packages 的相对位置。默认资源传输支持图片/图集和音频字节，JSON 资源需要显式扩展传输。defineApplication 根 inputs 与场景 props 是普通数据，不能把含函数的场景定义放入 signal；场景/宿主配置通过 GameCanvas 的显式引用输入传递。
