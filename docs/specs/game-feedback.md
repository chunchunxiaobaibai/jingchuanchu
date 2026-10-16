# game-feedback：游戏计时和反馈缓动

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/game-clock.ts、tweens.ts；运行于现有 Engine 固定步，不创建独立 requestAnimationFrame 或 setInterval 循环。

## 契约

游戏 clock 提供 after(seconds, callback)、every(seconds, callback) 与 cancel；tween({from,to,duration,easing,onUpdate,onComplete}) 返回可取消句柄。句柄归 scene Scope，scene 暂停不推进时间，销毁取消未完成任务。

首阶段 easing 为 linear、ease-in、ease-out、ease-in-out，from/to 为数字或键集合一致的数字对象。需要动画的目标由 onUpdate 显式更新，不让缓动器接管任意对象属性。duration 单位为秒，非正/非有限值报错；完成回调只运行一次。取消不假装完成。

固定步内注册的新计时/缓动从下一步开始；遍历期间取消不能破坏本步集合。callback 失败交给 Engine 的带来源错误路径。重复任务按已发生逻辑步推进，不按挂起期间的墙钟时间补发音效。

UI 的 CSS 动画和 HUD 交互不因游戏暂停自动停止。这个模块不提供复杂时间线、骨骼动画或全局 CSS 过渡管理。

## 直接验收

F1：倒计时、单次/重复任务随游戏暂停恢复，取消和销毁不再回调。

F2：位置/透明度等缓动完成一次，固定步注册及删除次序稳定。

F3：回调错误带任务来源，不能留下另一个浏览器循环。

测试：tests/game-feedback.test.ts，手动 advance，不用等待真实时间。
