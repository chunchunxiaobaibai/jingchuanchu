# state-store：按业务共享状态

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/store.ts；依赖 reactive-core，不依赖 DOM、Router 或认证。

## 定义与读取

```ts
const GameStore = defineStore({
  name: 'game-session',
  setup(context) {
    const score = signal(0);
    const doubled = computed(() => score() * 2);
    return {
      state: { score },
      getters: { doubled },
      actions: { addScore: (amount: number) => score.update((value) => value + amount) },
    };
  },
});
```

定义对象可共享，实例不可隐式全局共享。context.useStore(GameStore) 返回当前 owner 中同一实例；不同应用隔离。默认 owner 为应用；页面可显式 provide 同一定义取得页面私有实例，沿最近作用域解析。不允许循环创建 Store。

外部仅取得只读 state/getters 和受类型检查的 actions；可写信号留在 setup 闭包内。selector/computed 不复制整份状态，读取只订阅实际使用字段。actions 保留输入和结果类型，异步 action 的拒绝由调用方处理并带 Store/操作来源。

Store setup context 提供 scope、signal、显式服务获取及 runTask。异步操作采用 `context.runTask(async ({signal, commit}) => { /* await 请求 */ commit(() => { /* 写状态 */ }); }, {key?})`；同 key 后发任务使前次提交失效，未指定 key 的独立任务可并行。commit 在 owner/请求代次仍有效时批量写入，否则返回取消结果，不执行传入回调。

reset/dispose 使所有旧任务失效，实际 I/O 是否中断仍由加载器响应 signal；不声称能强行拦截业务绕过 commit 协议的任意 Promise 回调。多字段修改使用 batch，单个 action 不自动等于数据库事务。

## 所有权与重置

应用 Store 跨页保留；页面 Store 离页 dispose。reset 保持外部 Store 和字段读取句柄稳定，将公开 state 重设为实例构造时的初始快照，递增操作代次并通知 context.onReset 登记的业务清理；dispose 释放副作用和订阅。定义可显式标记 userScoped:true，供账号模块在身份切换时重置；匿名偏好单独保存。

持久化交给 save-data，默认不保存 Store 全部字段，不把 token、ECS handle、Engine 或 DOM 作为普通状态存储。game/session/game-store.ts 管跨页进度；仅本页的草稿使用局部 signal 或页面 Store，不自动都提升为全局状态。

## 直接验收

S1：同应用两个页面共享实例，两个应用完全隔离；页面 override 的实例随页面释放。

S2：派生值与 action 类型正确，外部无法直接写 state；两次批量更新只安排一批视图提交。

S3：reset/dispose 后旧异步结果不能写回，循环依赖诊断包含 Store 名称。

测试：tests/stores.test.ts 与类型 fixture。保留现有 StateStore 根入口和既有消费者，不把新 defineStore 强塞进旧构造器。
