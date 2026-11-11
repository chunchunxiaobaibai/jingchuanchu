# @xiaobaibaifqy/jingchuanchu-ecs

Jingchuanchu (镜川初) TypeScript engine ecs module。版本 0.6.0，MIT 授权。

开发指南、参数及使用约束统一在配套套件的 docs/index.html；API 见 docs/api/ecs.html。源码仓库内打开 ../../docs/index.html。

包提供编译后的 ESM 和 TypeScript 声明。请使用同一版本套件的配套依赖；浏览器项目只安装所需模块，tooling 作为开发依赖。

## 性能优化 API (0.5.0+)

### bulkQuery

为渲染、碰撞等热路径场景提供的批量查询优化 API。

```typescript
const iterator = world.bulkQuery(Position, Velocity);
const { buffer } = iterator.next().value!;

for (const entity of buffer) {
  // 只读访问，不修改组件
  const pos = world.require(entity, Position);
  // ...
}

iterator.return?.();
```

**性能提升**：10k 实体场景下比 `query()` 快 15-18%。

**约束**：
- 遍历期间禁止修改组件（`set`/`remove` 抛出错误）
- 适用于确定的批量只读遍历
- 需要边遍历边修改时继续使用 `query()` + `defer()`

