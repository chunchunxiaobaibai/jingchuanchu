# reactive-core：响应式基础

公共范围、命名和验证规则见 [SPEC](../../SPEC.md)。位置：packages/app/runtime/reactivity.ts；从 app/application 导出。模块不依赖组件、路由或游戏。

## 契约

```ts
interface ReadSignal<T> { (): ReadonlyData<T>; }
interface WritableSignal<T> extends ReadSignal<T> {
  set(value: T): void;
  update(reduce: (previous: ReadonlyData<T>) => T): void;
}
signal<T>(initial: T): WritableSignal<T>;
computed<T>(derive: () => T): ReadSignal<T>;
effect(run: (onCleanup: (cleanup: Cleanup) => void) => void, scope: Scope): Cleanup;
batch<T>(run: () => T): T;
```

signal 按 Object.is 比较传入值与上次写入值的身份；对象/数组通过 set/update 替换，原地嵌套赋值不作为更新方式。初始化/写入时取得独立只读快照，读取复用该快照；同一个已被调用方原地修改的输入对象不被视为新写入。UI/Store 数据限普通可结构化复制数据，外部消费者不能借只读引用修改源，不能每次 read 都深拷贝。

computed 自动追踪同步计算实际读取的依赖，按需计算并缓存；分支变化移除不再使用的依赖。它只读，不负责发送请求或把结果写回另一个 signal。计算期间写依赖、循环计算要报带来源的错误。

effect 用于外部能力同步；上次清理先于下次执行，Scope 退出后最终清理且不再重跑。异步函数不作为 effect 的自动请求协议：await 后读取不被追踪，异步业务使用显式操作和取消信号。

batch 内写入立即可读，派生值读取必须反映这些写入；对外渲染通知在批次结束合并。不承诺事务回滚，回调失败不静默撤销部分业务写入。effects 在微任务调度，effect 导致的新写入进入后续批次，循环回写有明确诊断。

组件层提供 nextTick(): Promise<void> 等待已安排的视图更新提交；nextTick 不等待网络或下一游戏帧，没有待处理更新时在微任务返回。

## 直接验收

- R1：同值 set 不触发通知；两次写入在 batch 外部只提交一批视图通知。
- R2：computed 缓存、动态分支依赖及批次内一致读取可验证。
- R3：Scope 释放后 effect 不执行；每次重跑前的清理只执行一次。
- R4：循环派生与错误回写给出可定位错误，不能挂死更新队列。

验证文件：tests/reactivity.test.ts；无 DOM、无浏览器。此模块不宣称已实现 Proxy 深层响应式、SSR 或调试扩展。
