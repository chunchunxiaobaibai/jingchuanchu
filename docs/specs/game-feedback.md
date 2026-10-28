# game-feedback：游戏计时和反馈缓动

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/game-clock.ts、tweens.ts；运行于现有 Engine 固定步，不创建独立 requestAnimationFrame 或 setInterval 循环。

实现进度：T22 游戏 clock 自动项已通过，createGameClock 已从 application 导出；T23 的 clock.tween 自动项已通过。Node 手动步进与真实 Engine 集成已验证，GameCanvas 自动接线仍待 T24。

## 契约

游戏 clock 提供 after(seconds, callback)、every(seconds, callback) 与 cancel；tween({from,to,duration,easing,onUpdate,onComplete}) 返回可取消句柄。句柄归 scene Scope，scene 暂停不推进时间，销毁取消未完成任务。

createGameClock({scope,source?}) 返回 after/every/advance/setActive/dispose 与 disposed；source 为诊断标签（默认 game-clock）。after/every 返回带 status 与 cancel() 的句柄，status 为 pending/completed/cancelled/failed；单次开始回调前视为 completed，失败改为 failed，重复任务持续 pending 直到取消或失败。seconds 必须有限且大于 0，callback 必须是同步函数；运行时发现 Promise 返回值时拒绝并消费其拒绝结果，避免游离异步错误。

advance(delta) 只接受有限非负秒数，由所属 Engine 的 fixed 系统调用，不自动注册全局系统；0 不执行任务。setActive(false) 暂停推进，恢复后不补墙钟时间。重复任务每个逻辑步最多执行一次，步长超过周期时跳过多余触发但保留周期相位，避免一次步进堆叠音效。按注册顺序处理本步快照；本步新增任务下步才计时，取消后跳过，暂停/销毁中断余下回调。回调失败取消该任务并抛 GameClockError（source/operation/taskId），其余任务保留，交由 Engine 的 SystemError 路径停止驱动。禁止回调中重入 advance。dispose 取消全部 pending 任务且幂等；退出后不能注册或推进。GameCanvas 的自动接线在 T24 完成。

clock.tween({from,to,duration,easing?,onUpdate,onComplete?}) 在同一 clock 下创建缓动，返回 status/cancel 句柄。onUpdate 接收扩大数值字面量但保留精确对象键的只读值；端点注册时拷贝，不修改用户对象。注册时不调用 onUpdate；下一固定步开始输出，最终精确输出 to 一次，然后标记 completed 并执行 onComplete。onUpdate 内取消/退出抑制 onComplete；当前缓动的更新/完成为一个同步回调段，暂停只阻止后续任务。回调仅支持同步；失败标记 failed、移除任务并抛带 source/operation/taskId 的 TweenError，经同一 Engine 错误路径处理。

每次 advance 开始先取得计时器与缓动两份快照并推进已有任务，再按计时器→缓动、各自注册顺序回调。因此任何回调里新建的计时/缓动都从下一步开始，互相创建时也不提前输出。取消/销毁幂等；暂停不推进、恢复不补墙钟；与 clock 共享 scope，不额外创建驱动。

首阶段 easing 为 linear、ease-in、ease-out、ease-in-out，from/to 为数字或键集合一致的非空数字对象。需要动画的目标由 onUpdate 显式更新，不让缓动器接管任意对象属性。duration 单位为秒，非正/非有限值报错；完成回调只运行一次。取消不假装完成。

固定步内注册的新计时/缓动从下一步开始；遍历期间取消不能破坏本步集合。callback 失败交给 Engine 的带来源错误路径。重复任务按已发生逻辑步推进，不按挂起期间的墙钟时间补发音效。

UI 的 CSS 动画和 HUD 交互不因游戏暂停自动停止。这个模块不提供复杂时间线、骨骼动画或全局 CSS 过渡管理。

## 直接验收

F1：倒计时、单次/重复任务随游戏暂停恢复，取消和销毁不再回调。

F2：位置/透明度等缓动完成一次，固定步注册及删除次序稳定。

F3：回调错误带任务来源，不能留下另一个浏览器循环。

测试：tests/game-feedback.test.ts，手动 advance，不用等待真实时间。
