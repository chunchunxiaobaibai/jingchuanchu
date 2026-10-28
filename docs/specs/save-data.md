# save-data：游戏进度和偏好

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/save-data.ts；与 Store 通过显式 select/restore 对接，不自动序列化全部状态。

实现进度：T27/T28 自动项已通过，defineSave、SaveService.save/load/reset、不可变匿名/用户命名空间与 StorageAdapter 已导出（含惰性的 localStorage 包装）。测试只用内存/注入 Storage 对象，未操作真实存档。

## 已实现的版本与数据路径

defineSave 的 version 为正安全整数；select/parse 为同步数据函数，migrate 为 `{旧版本号: oldData => 当前格式}` 的显式映射，只允许小于当前版本的声明。选出的 DTO 必须是有限 JSON 数据，不接受 undefined、函数、类/DOM/Engine、稀疏数组、符号字段、访问器或循环；parse 前复制选择结果，避免解析器修改调用方选中的对象。restore 由业务显式调用，服务不替业务提交状态。

save(definition,state) 选择/校验后写 `{schemaVersion,data}`，返回 saved/invalid/unavailable；只有 adapter.set 成功才返回 saved。load(definition) 返回 loaded(data,migratedFrom?)/empty/corrupt/incompatible/unavailable；数据深只读，迁移后仍经当前 parse，未知/较新版本不猜测迁移，不自动回写、删除或调用 restore。

`new SaveService({storage?,namespace?})` 默认适配器只在显式操作时查找 localStorage，构造不访问宿主存储；当前匿名实际键为 `jcc:save:anonymous:${encodeURIComponent(definition.key)}`。StorageAdapter 的 get 返回 string|null，set/remove 返回 Promise<void>；拒绝和非法返回值保留 SaveError.key/operation/cause/storageKey。此阶段没有自动节流、每 tick 写入或用户切换逻辑。

## 契约

defineSave({key, version, select, parse, migrate?, restore}) 定义保存记录；SaveService 提供 save、load、reset，返回包含成功、空记录、损坏、版本不兼容、存储不可用的结果。

StorageAdapter 提供 get/set/remove 的 Promise 接口，默认以 localStorage 包装实现并捕获异常；未来可替换为其他存储。记录包含 schemaVersion 和 data，parse 校验外部读入的数据。migrate 只处理声明支持的旧版本，不猜测未知格式。

load 返回校验后的数据及结果，不自行调用 restore 改写业务状态。业务在所属 Store 的 runTask/commit 内调用恢复操作；用户切换或 owner 退出后不提交旧加载结果。

select 白名单只包括偏好和明确的游戏进度：音量、静音、解锁关卡、高分等。不得存储 token、密码、Engine、World、Entity 或 DOM。账号项目使用明确的用户命名空间；匿名偏好与用户进度分开，不能在用户切换后恢复上个账号的数据。

默认显式保存，在结算/设置提交时调用；可配置节流但不在每个 tick 自动写入。损坏或不兼容记录可以回退初始值并提示错误，不静默删除原记录；reset 由明确业务操作触发。保存失败不得把内存状态改成已持久化成功。

## 直接验收

D1：选择字段、保存加载、支持版本迁移和 schema 校验正确，未选字段不进入记录。

D2：损坏/不兼容/存储拒绝均有结果，原坏记录不被自动删除。

D3：匿名与两名用户记录隔离，退出不串档；普通页面状态不被误恢复。

测试：tests/save-data.test.ts，注入存储实现；测试不操作开发者真实浏览器存档。

## 命名空间、坏档与显式重置

namespace 默认为 `{kind:'anonymous'}`；用户记录显式提供 `{kind:'user',userId}`，userId 必须非空且可编码。构造时计算不可变前缀，后续修改传入对象不会切换旧实例的账户。匿名键保持 `jcc:save:anonymous:${encodedKey}`，用户键为 `jcc:save:user:${encodedUserId}:${encodedKey}`；分段编码避免分隔符碰撞，匿名与同名用户仍分离。

reset(definition) 只 remove 当前实例命名空间中的该记录，返回 reset/unavailable；不调用 restore、不改内存状态。坏 JSON、坏 envelope、parse 失败与不兼容版本均保留原始字符串，不自动删除、回写或恢复初值。删除失败也保留错误来源，不能报告已重置。

用户切换创建对应命名空间的服务实例；旧 load 仍只返回 DTO，业务必须用 Store.runTask/commit 代次控制恢复。测试用真实 StoreTasks.invalidate 模拟用户切换，验证旧读入晚到后不能提交；模块不把 load 变成隐式账户会话或自动恢复任务。
