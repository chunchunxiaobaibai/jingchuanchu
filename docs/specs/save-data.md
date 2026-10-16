# save-data：游戏进度和偏好

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/save-data.ts；与 Store 通过显式 select/restore 对接，不自动序列化全部状态。

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
