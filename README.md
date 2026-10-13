# 小白 TS 2D 引擎

面向浏览器的 TypeScript ECS 引擎，以及使用该引擎制作的基础版「你画我猜」。引擎与游戏分开，客户端和服务端均为 TS，使用严格类型检查；页面结构和样式使用 HTML/CSS。

## 启动

需要 Node.js 22.12 或更高版本。项目使用 npm，锁文件已保存。

```bash
npm ci
npm run dev
```

访问 http://localhost:5173 。打开两个浏览器标签页，填写不同昵称：一人创建房间，另一人用房间码加入。至少 2 人到场后由房主开始。鼠标或触摸绘画，其他玩家输入猜词。

构建后，单个 Node 服务同时提供静态网页和 WebSocket：

```bash
npm run build
npm start
```

访问 http://localhost:3001 。可通过 `PORT` 修改服务端端口。开发代理固定指向 3001，修改开发端口时也需要调整 `vite.config.ts`。浏览器通过当前网页地址连接 `/ws`，支持 HTTPS 页面对应的 WSS。跨域连接白名单通过逗号分隔的 `ALLOWED_ORIGINS` 配置；同源请求自动允许。

## 引擎能力

| 目录               | 内容                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/ecs`     | 唯一组件 token、稀疏集、代际实体 ID、组件交集查询、世界资源、延迟命令                               |
| `packages/core`    | 固定步长调度、独立渲染阶段、稳定系统顺序、耗时记录、模块依赖、作用域清理、类型化事件                |
| `packages/browser` | requestAnimationFrame 循环、后台暂停恢复、Canvas 2D、坐标转换、ECS 基础图形、指针输入、异步资源缓存 |
| `packages/net`     | 浏览器连接、运行时解码边界、房间成员与容量、限流、Node WebSocket 适配、心跳和积压保护               |
| `games/draw-guess` | 玩家/分数组件、权威回合规则、画布文档、协议与数据校验                                               |
| `apps/server`      | HTTP 静态服务、房间与连接协调、引擎更新时间驱动                                                     |
| `apps/client`      | 游戏 UI、画笔与猜词操作、本地笔迹预览、同步事件处理                                                 |

这些目录是源码模块边界，目前不作为独立 npm 包发布。引擎不能导入游戏；Node WebSocket 实现在 `packages/net/server.ts`，浏览器入口不会导入它。

### 使用 ECS 与系统

```ts
import { Engine } from './packages/core/index.js';
import { component } from './packages/ecs/index.js';

const Position = component<{ x: number; y: number }>('Position');
const Velocity = component<{ x: number; y: number }>('Velocity');
const engine = new Engine({ tickRate: 30 });
const entity = engine.world.create();
engine.world.set(entity, Position, { x: 0, y: 0 });
engine.world.set(entity, Velocity, { x: 10, y: 0 });
engine.addSystem({
  id: 'movement',
  update({ world, delta }) {
    for (const entity of world.query(Position, Velocity)) {
      const position = world.require(entity, Position);
      const velocity = world.require(entity, Velocity);
      position.x += velocity.x * delta;
      position.y += velocity.y * delta;
    }
  },
});
engine.start();
engine.advance(1 / 30);
engine.dispose();
```

`delta` 的单位为秒。组件数据可以直接修改；遍历时建议通过 `world.defer(w => w.destroy(entity))` 延迟结构变更，由引擎在每个固定逻辑步结束后 `flush()`。网络 ID 与 ECS ID 分离，实体 handle 不用于网络传输。

系统默认属于 `fixed` 阶段；设置 `phase: 'render'` 后每次 `advance` 运行一次。`order` 小的先执行，相同值按注册顺序。默认最多补算 5 步，丢弃超额时间，防止后台恢复后无限补帧。房间倒计时使用服务器截止时间，不依赖补帧数量。

模块通过 `engine.install([...])` 一次性安装，声明 `id` 和 `dependencies`；先检查依赖缺失和循环，再按依赖顺序执行 `setup(engine, scope)`。监听器、系统和资源释放函数通过作用域登记，销毁时按相反顺序清理。

## 玩法与网络

- 每房间 2–10 人，房主开始，按开始时的成员顺序每人绘画一次。
- 每回合 60 秒；新加入的玩家可以猜词，下局进入绘画顺序。
- 首位猜中得 100 分，之后递减 20 分，最低 40 分；每位玩家猜中，绘画者加 25 分。
- 超时或所有猜词玩家猜中后揭晓；房主点击下一回合；全部轮完可以重新开始。
- 服务器校验身份、回合和操作；未揭晓答案只发给绘画者。
- 正确猜测记录显示「猜对了！」，避免泄露答案。猜词输入通过 `textContent` 展示。
- 笔画通过顺序事件同步，回合/成员变化通过个性化快照同步。新加入获取当前画布；事件序号异常时客户端请求完整快照。
- 绘画者有本地笔迹预览，服务器确认后纳入共享画布。最多 2,000 个笔画片段/20,000 个点，可清空继续绘画。
- 房主离开后转移给剩余玩家；绘画者离开会揭晓答案；不足两人回到等待状态。
- 断线显示重新连接入口，重新加入恢复当前状态，作为新玩家进入，不保留旧身份与分数。

## 验证

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` 包括内核、游戏规则与真实 WebSocket 集成测试。浏览器测试使用独立 Chromium 配置，检查两位玩家绘画同步、猜词、计分、换人、退出、窄屏布局与输入转义。浏览器测试会启动构建后的服务，所以先执行构建并确保 3001 端口空闲。Linux 需要 Chromium 的运行库；可按本机环境安装 Playwright 浏览器依赖。

## 当前边界

这是可扩展的基础版本：房间仅在单进程内存中存在，服务重启会清空；没有账号、持久化、跨进程房间、匹配、编辑器、音频或物理系统。绘画由指针操作，菜单与表单支持键盘操作。后续可增加角色移动/碰撞示例验证连续模拟玩法，再按实际需求加入相机、音频、资源格式与预测同步。

模块职责、验收标准和参考资料见 [架构说明](docs/architecture.md)。
