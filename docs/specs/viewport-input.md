# viewport-input：画布尺寸、坐标与输入动作

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/viewport.ts、input-actions.ts；复用 renderer.resize/toPoint 和现有键盘/指针清理。

实现进度：T20 自动项已通过，createViewport 已从 application 入口导出，支持注入几何驱动或默认宿主 ResizeObserver/DPR 驱动，并复用实际 Canvas2D.resize/toPoint。Canvas2D 可选第四构造参数支持显式像素比，旧调用方式保持。T21 已提供 defineActions/createActions、固定步采样与键盘/主指针/虚拟来源的宿主接线，定向 Node 事件与类型检查通过。Node 宿主/假 2D context 的验证不等于实际浏览器光栅画面/设备缩放已验收。

## 视口

createViewport({canvas, width, height, fit:'contain', maxPixelRatio:2, scope, driver?}) 管逻辑分辨率、CSS 显示区域和像素缓冲。默认保持逻辑比例、居中留边；不要每帧重设 canvas.width/height。ResizeObserver/DPR 通知在变化时更新，Node 使用注入几何驱动。

默认只实现 contain；其他裁切/拉伸模式不以含糊的 auto 代替。toGamePoint(event) 返回逻辑点及 inside 标志；相机转换复用既有 screenToWorld。留边区输入不当成画布边界内的点击。组件 UI 仍由 CSS/Less 布局，不跟随 Canvas 像素缓冲缩放。

几何驱动提供 measure/observe/apply，可选 toPoint/dispose；measure 返回容器客户区 left/top/width/height/pixelRatio。视口计算居中的 CSS 矩形，缓冲为 round(逻辑尺寸 × 受限 DPR)，CSS 尺寸变化本身不重设逻辑缓冲。maxPixelRatio 当前不超过既有 Canvas2D 上限 2。inside 使用左/上包含、右/下不包含的边界；外部点沿用 renderer 的夹取坐标但 inside=false，零尺寸时返回 (0,0,false)。每次点转换先刷新几何，避免滚动后的旧坐标。驱动退出与 scope 退出幂等，构造失败也回收已接管的驱动。

默认驱动使用 canvas.parentElement 作为已有明确 CSS 尺寸的专用容器，按客户区（包含 padding、不含 border）测量；Canvas 绝对定位并居中，静态容器临时设为 relative，退出恢复自有样式。ResizeObserver 观察容器，宿主 resize 与重新挂接的 resolution matchMedia 监听 DPR；缺少 ResizeObserver 时依靠 resize/点转换刷新，不轮询。可选 bounds 返回 Canvas 实际客户矩形，用于 inside 判断；默认坐标映射复用 Canvas2D.toPoint。Canvas2D 构造器新增可选第四参数 pixelRatio，旧三参数调用保留原默认行为。

## 输入动作

defineActions 定义轴与离散动作，键盘映射为正负键组、pointer 映射为主指针点按/拖动；触摸通过 Pointer Events 同一路径。actions.read() 在固定步开始采样一次并返回只读状态，pressed/released 在该步消费；持续按下与 UI 离散命令分开。

动作描述使用 `defineActions({moveX:{kind:'axis',negative:['KeyA'],positive:['KeyD']},fire:{kind:'button',keys:['Space'],pointer:'primary'}})`，可选 preventDefault 标记由宿主适配处理。轴合并键盘与带 source 标识的虚拟值并夹取到 [-1,1]；按钮合并全部来源，释放一个来源不清掉仍按住的其他来源。采样返回 axes/buttons/pointer 深只读快照，按钮与主指针提供 down/pressed/released，快速按下并松开仍保留两个边沿直到一次 read。clear/暂停清空持有及边沿，不合成游戏命令；不活动时忽略新输入。指针初始按下必须 inside，拖动可继续到外部。

宿主失焦、进入可编辑控件、页面隐藏、游戏暂停和 owner 退出时清理状态/捕获；输入法组合不生成游戏按键。声明 preventDefault 的游戏键只在活动宿主内处理，主指针映射的该标记在已接受的 down/move/up 上生效。HUD 输入框和按钮仍可交互。

createActions({definition, canvas, viewport, scope, host?}) 返回 read/clear/setActive/setVirtual/dispose 与 disposed；host 默认为 canvas.parentElement（无父级则 canvas），必须包含该 Canvas 且属于同一文档。同一 Canvas 只能有一个活动控制器。键盘事件须来自宿主内的非交互焦点，编辑控件、按钮/链接及 Ctrl/Meta/Alt 快捷键保留原行为；指针仅在 Canvas 有效区域开始并以 preventScroll 聚焦 Canvas。无 tabindex 时临时设为 0，Canvas 临时 touch-action:none 支持 Pointer Events 拖动；退出恢复自有值与样式 priority，保留外部改动。主指针取消、失焦、隐藏、进入编辑区和组合输入清空状态并释放捕获；setActive(false) 为显式暂停，恢复不重放持有输入。虚拟输入由调用方在 HUD 交互中用 setVirtual(action,value,source?) 写入，允许按钮焦点但不允许编辑/组合/隐藏/暂停期间写入；多控件用独立 source。read 由固定步调用，不内部启动循环。已退出时 read/setVirtual 报 ActionError，dispose 幂等。

页面提供通用虚拟方向键时转换为同一动作状态，不另写第二套移动逻辑。首阶段不做手柄、复杂多点手势识别或所有设备自动布局。

## 直接验收

V1：不同 CSS 尺寸和像素比下逻辑点击位置一致；未变化尺寸不重置缓冲，留边点击可区分。

V2：键盘、主指针及虚拟按键读取相同动作；暂停/失焦/退出不留卡键或捕获。

V3：输入法与可编辑控件不驱动角色；每固定步只消费一次离散边沿。

测试：tests/viewport-input.test.ts 验证注入几何驱动，tests/input-actions.test.ts 验证纯数据采样，tests/input-action-types.ts 验证动作键和值类型，tests/browser-actions.test.ts 用 Node DOM 事件和模拟捕获验证宿主接线；既有 tests/input.test.ts 检查输入兼容性。手机实际触控、缩放和焦点手感待人工验收。
