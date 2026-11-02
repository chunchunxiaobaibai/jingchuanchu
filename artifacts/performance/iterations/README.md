# 2026-11-02：P01—P06 性能迭代交付记录

规格：[performance-spec](../../../tasks/performance-spec.md)；顺序：[plan](../../../tasks/plan.md)；状态：[todo](../../../tasks/todo.md)。起点包含上轮绘制队列与条件模板修复，不能把上轮收益重复计算进本轮。

## 实施结果与边界

P01—P06 已完成。运行时代码只改现有 World/SparseSet、ActionSampler 和 detectCollisions，保持包、公开函数与签名。没有新增 ECS 遍历 API、改变实体存储、替换调度/响应式/渲染后端，也没有引入对象池、空间索引或跨帧组件缓存。diagnostics 默认值与工作量保持原样。

- P02：query 直接生成一份预分配句柄快照，按索引遍历；保留存活、交集、顺序、首次 next 时快照与索引回收语义。第一次 push 方案表现不稳定，未采用，原始结果保留在 p02-query.json。
- P03：require 保留原有安全检查，私有 SparseSet 一次查找 slot；不把已存储的 undefined 误判为缺失。
- P04：构造时保存冻结定义的条目列表，直接构造固定结构的冻结动作快照，减少每步枚举与整体 structuredClone。指针在变化时复制/深冻结，后续快照只共享这个不可变叶节点。返回记录仍为普通对象，特殊动作名不影响原型，旧快照保持不变。
- P05：矩形包围体仍计算原有四角的世界坐标与 AABB，去除 points/map/spread 数组；扫掠、圆形判定、mask、事件与浮点运算分组保持原有设计。同 X 轴密集分布仍有平方扫描上界。

## 热路径结果

Windows x64、Node v24.12.0、i7-12700H。基准先预热 5 批，再测 21 批；每批重复次数由 JSON 的 batch 标明。表中是 ms/完整操作的中位数，p95 是批平均值的分位数，不是浏览器逐帧尾延迟。测量期间未并行运行测试或构建。

以下比较本轮 P01 起点与 P06 两次独立测量，包含各项累计收益；不能把碰撞的全部降幅归因于 P05 单项。各轮 checksum 一致，原始 JSON 附有运行时代码的 SHA-256。

| 操作                    | P01 起点 ms | P06 首测 ms | P06 复测 ms | 累计耗时降幅 |
| ----------------------- | ----------- | ----------- | ----------- | ------------ |
| 10k 实体，无 token 查询 | 0.50378     | 0.34230     | 0.34415     | 31.7%–32.1%  |
| 10k 实体，单组件查询    | 0.65107     | 0.35076     | 0.35988     | 44.7%–46.1%  |
| 10k 实体，四组件查询    | 0.83698     | 0.54309     | 0.53780     | 35.1%–35.7%  |
| 三动作空闲采样          | 0.005433    | 0.001344    | 0.001390    | 74.4%–75.3%  |
| 三动作持有采样          | 0.006313    | 0.001296    | 0.001338    | 78.8%–79.5%  |
| 1k 矩形，稀疏碰撞       | 0.87710     | 0.23700     | 0.22850     | 73.0%–73.9%  |
| 1k 矩形，同 X 轴碰撞    | 1.68768     | 0.98138     | 1.00776     | 40.3%–41.9%  |

require 在分开的整套基准中出现小规模波动，因此没有直接把阶段结果当成稳定收益。随后专项对照只替换 World.require 方法，其余源码保持相同，每种实现有独立调用位置与预热；同一进程内轮换测量顺序，31 个样本、每样本 50 次完整访问循环。两次独立运行：

| 操作        | 原实现 ms，首测/复测 | 采用的 slot 实现 ms，首测/复测 | 降幅        |
| ----------- | -------------------- | ------------------------------ | ----------- |
| 1k require  | 0.024762 / 0.025290  | 0.021122 / 0.021524            | 14.7%–14.9% |
| 10k require | 0.345722 / 0.342094  | 0.294710 / 0.296432            | 13.3%–14.8% |

另一种先 get 值、只在 undefined 时检查 has 的候选，与 slot 实现差异没有足够明确的额外收益，未采用。最终保留对 undefined 也直接定位 slot 的实现。

## 原生对照与真实浏览器

Node native 对照仍执行相同移动、图层排序和模拟 Canvas 调用；校验移动数据及绘制顺序敏感校验和，不测实际 GPU。10k 对象：引擎移动从本轮起点 0.95342 降为 0.65430 ms，约降低 31.4%；绘制从 2.63569 降为 2.04506 ms，约降低 22.4%。最终同进程原生路径分别为 0.06908、0.79901 ms，引擎仍约为其 9.5 倍、2.6 倍。不能把微基准倍数当成完整游戏 FPS 差距。

本轮用户会话已授权浏览器性能验证。真实 Chrome 156 headless、生产 Vite 构建、1280×900、DPR=1、无 CPU 降速；每个场景使用独立 Canvas，预热 30 帧、记录 120 帧，两轮反转原生/引擎顺序。

| 对象数 | 原生更新 ms          | 引擎更新 ms | 原生绘制提交 ms | 引擎绘制提交 ms |
| ------ | -------------------- | ----------- | --------------- | --------------- |
| 1k     | 低于计时精度，显示 0 | 0.1         | 0.3             | 0.4             |
| 10k    | 0.3                  | 1.0         | 2.2–2.6         | 3.0–3.3         |

每轮原生/引擎最终像素哈希相同。两边帧间隔中位数均约 16.7 ms，全部对照采样中无超过 25 ms 的间隔。drawSubmission 不代表 GPU 完成时间，rAF 间隔不代表屏幕呈现延迟。浏览器本轮没有重建同会话的优化前版本，因此不报告严格配对的浏览器前后提速百分比。

参考游戏生产构建另行记录 362 帧，约 6 秒，倒计时 30→24 秒。游戏 rAF 回调 CPU 中位数 0.4 ms，p95 0.8 ms，最大 1.2 ms；帧间隔中位数 16.7 ms，p95 16.8 ms，无超过 25 ms 的间隔。暂停后停止请求帧、恢复后重新请求帧，页面异常为 0。小型第一关的有限采样不能证明移动设备、长时间内存或完整关卡流程通过。

## 实际检查

- P02：ecs/renderer/collision/rendering-updates 12/12；调整查询快照分配后 ECS 6/6。
- P03：ecs/scenes/renderer/collision 13/13。
- P04：input-actions/browser-actions/game-canvas 11/11。
- P05：collision/renderer/reference-scene 9/9。
- P06：ecs/core/scenes/renderer/rendering-updates/collision/input-actions/browser-actions/canvas-runtime/game-canvas/reference-scene/reference-play 共 48/48。这些阶段测试有重叠，不累加成独立总数。
- 类型检查、旧 API 名称/入口检查通过：118 个原公开名称与 0.3.0 入口保留。名称检查不替代行为和签名检查。
- 新增回归覆盖查询期间移除/恢复组件、索引回收与无过滤查询、undefined 必需组件访问、动作快照冻结/特殊动作名、旋转父变换/负缩放/offset/直接修改/零尺寸/非法矩形。
- 最终 Prettier 与 git diff --check 通过；没有运行完整分发/包发布验证，没有推送或发布。没有把 H01—H04 整体标记为完成。

## 原始记录与复现

- 起点：[p01-baseline.json](p01-baseline.json)、[p01-native.json](p01-native.json)。
- 分阶段：[p02-query.json](p02-query.json)（未采用的首版）、[p02-query-final.json](p02-query-final.json)、[p03-require.json](p03-require.json)、[p04-actions.json](p04-actions.json)、[p05-collision.json](p05-collision.json)。
- 最终：[p06-final.json](p06-final.json)、[p06-repeat.json](p06-repeat.json)、[p06-native.json](p06-native.json)。
- require 专项：[p06-access-compare.json](p06-access-compare.json)、[p06-access-repeat.json](p06-access-repeat.json)，包含对照方法源码。
- 浏览器：[p06-browser.json](p06-browser.json)、[browser-comparison.json](browser-comparison.json)。浏览器辅助产物现在随指定输出目录保存，不覆盖上轮审查原始记录。

在依赖平台匹配的 Node 环境运行：

```bash
npm run benchmark:hot-paths -- artifacts/performance/iterations/current-hot-paths.json
npm run benchmark:native -- artifacts/performance/iterations/current-native.json
npm run benchmark:browser -- artifacts/performance/iterations/current-browser.json
```

最后一条显式启动已安装的 Chrome，不属于默认测试。当前 node_modules 为 Windows 依赖；WSL 环境可使用本轮实际采用的 `node.exe node_modules/tsx/dist/cli.mjs --conditions=source scripts/benchmarks/hot-paths.ts artifacts/performance/iterations/current-hot-paths.json`，其他脚本同理。浏览器环境/设备改变后必须重新测量，不能沿用这里的数字。
