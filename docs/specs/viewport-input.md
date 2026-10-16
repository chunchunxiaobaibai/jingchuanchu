# viewport-input：画布尺寸、坐标与输入动作

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/viewport.ts、input-actions.ts；复用 renderer.resize/toPoint 和现有键盘/指针清理。

## 视口

createViewport({canvas, width, height, fit:'contain', maxPixelRatio:2, scope, driver?}) 管逻辑分辨率、CSS 显示区域和像素缓冲。默认保持逻辑比例、居中留边；不要每帧重设 canvas.width/height。ResizeObserver/DPR 通知在变化时更新，Node 使用注入几何驱动。

默认只实现 contain；其他裁切/拉伸模式不以含糊的 auto 代替。toGamePoint(event) 返回逻辑点及 inside 标志；相机转换复用既有 screenToWorld。留边区输入不当成画布边界内的点击。组件 UI 仍由 CSS/Less 布局，不跟随 Canvas 像素缓冲缩放。

## 输入动作

defineActions 定义轴与离散动作，键盘映射为正负键组、pointer 映射为主指针点按/拖动；触摸通过 Pointer Events 同一路径。actions.read() 在固定步开始采样一次并返回只读状态，pressed/released 在该步消费；持续按下与 UI 离散命令分开。

宿主失焦、进入可编辑控件、页面隐藏、游戏暂停和 owner 退出时清理状态/捕获；输入法组合不生成游戏按键。声明 preventDefault 的游戏键只在活动宿主内处理。HUD 输入框和按钮仍可交互。

页面提供通用虚拟方向键时转换为同一动作状态，不另写第二套移动逻辑。首阶段不做手柄、复杂多点手势识别或所有设备自动布局。

## 直接验收

V1：不同 CSS 尺寸和像素比下逻辑点击位置一致；未变化尺寸不重置缓冲，留边点击可区分。

V2：键盘、主指针及虚拟按键读取相同动作；暂停/失焦/退出不留卡键或捕获。

V3：输入法与可编辑控件不驱动角色；每固定步只消费一次离散边沿。

测试：tests/viewport-input.test.ts，注入驱动及 Node 事件。手机实际触控、缩放和焦点手感待人工验收。
