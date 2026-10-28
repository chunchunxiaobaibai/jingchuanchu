# 组件、表单、Store 与页面路由

本教程使用当前源码的 application 入口，前提是已按 [快速入门](getting-started.md) 创建配套项目并安装依赖。下面在默认参考游戏旁新增 bonus 页，不修改现有 play 页。所有完整代码块标明目标文件；同名 CSS 可换成 Less，组件不写内联样式或脚本。

## 生成文件

在游戏目录执行一次；若已经生成同名业务，直接编辑已有文件：

```bash
npm run generate -- page bonus --route /bonus
npm run generate -- component score-editor --shared
npm run generate -- store score --domain session
```

page 会在 src/app/app-routes.ts 注册名为 bonus 的懒页面。component 只生成文件，不自动注册到父组件或插入 HTML。以下代码分别替换新生成的文件，保留原应用配置和启动入口。

## 用 Store 保存跨页业务状态

```ts title="src/game/session/score-store.ts"
import { computed, defineStore, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const ScoreStore = defineStore({
  name: 'session/score',
  setup() {
    const score = signal(0);
    return {
      state: { score },
      getters: { rank: computed(() => (score() >= 100 ? '达标' : '继续加油')) },
      actions: {
        setScore(value: number) {
          if (!Number.isFinite(value) || value < 0) return false;
          score.set(value);
          return true;
        },
      },
    };
  },
});
```

页面通过 context.useStore(ScoreStore) 按需取得应用内共享实例，不需要在 app-config.ts 注册 Store。不同应用挂载彼此隔离。对外 state/getters 只能读取，写入经过 actions；不要把 Store 的整份状态镜像到另一个全局对象。页面草稿单独保留，提交时再改业务状态。

## 定义可复用的数字编辑组件

```ts title="src/components/score-editor/score-editor.ts"
import {
  computed,
  defineComponent,
  input,
  model,
  output,
  writableModel,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

export const ScoreEditor = defineComponent({
  selector: 'score-editor',
  inputs: { label: input<string>({ default: '得分' }) },
  models: { value: model<number>({ required: true }) },
  outputs: { submitted: output<number>() },
  setup(context) {
    const numeric = writableModel<number>({
      get: context.models.value,
      set: (value) => context.models.value.set(value),
      convert: 'number',
    });
    const valid = computed(() => numeric.validation().valid && context.models.value() >= 0);
    return {
      label: context.inputs.label,
      numeric,
      valid,
      submit() {
        if (valid()) context.emit('submitted', context.models.value());
      },
    };
  },
});
```

```html title="src/components/score-editor/score-editor.html"
<label>
  {{ label }}
  <input type="number" min="0" model:value="numeric" />
</label>
<p>当前输入：{{ numeric }}</p>
<button type="button" :disabled="!valid" @click="submit()">提交得分</button>
```

```css title="src/components/score-editor/score-editor.css"
label {
  display: grid;
  gap: 0.5rem;
}
input,
button {
  font: inherit;
  padding: 0.5rem;
}
```

input 是父传子的只读输入，output 是带类型的事件，model 是父子共享的可写目标。对象默认值用工厂，例如 `input<{score:number}>({default:()=>({score:0})})`。引用型能力只有显式 input({mode:'reference',...}) 才保留身份，普通状态不能装函数、DOM、图片或引擎对象。

数字输入需要 writableModel 的 convert:'number'。清空/输入非法数字时，保留 DOM 草稿和 validation，不强制把业务值改成 0。要显式撤销无效草稿，调用 numeric.resetDraft()。普通文本直接绑定 signal<string>；复选框使用 model:checked；多选 select 使用 convert:'strings' 的数组适配。动态选项会在结构更新后同步选择，程序回写不触发 input/change。

## 在页面中装配并提交

```ts title="src/pages/bonus/bonus-page.ts"
import { definePage, RouteLink, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ScoreEditor } from '../../components/score-editor/score-editor.js';
import { ScoreStore } from '../../game/session/score-store.js';

export const BonusPage = definePage({
  selector: 'game-bonus-page',
  components: [ScoreEditor, RouteLink],
  setup(context) {
    const store = context.useStore(ScoreStore);
    const draft = signal(store.state.score());
    const notice = signal('');
    return {
      draft,
      notice,
      score: store.state.score,
      rank: store.getters.rank,
      submit(value: number) {
        notice.set(store.actions.setScore(value) ? '已提交' : '得分无效');
      },
      restoreDraft() {
        draft.set(store.state.score());
      },
    };
  },
});
```

```html title="src/pages/bonus/bonus-page.html"
<main>
  <h1>得分编辑示例</h1>
  <score-editor :label="'本次得分'" model:value="draft" @submitted="submit($event)"></score-editor>
  <button type="button" @click="restoreDraft()">恢复已提交得分</button>
  <p>已提交：{{ score }} · {{ rank }}</p>
  <p role="status">{{ notice }}</p>
  <route-link :to="{name:'home'}"><template slot="default">返回首页</template></route-link>
</main>
```

```css title="src/pages/bonus/bonus-page.css"
main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}
score-editor {
  display: block;
  margin-block: 1rem;
}
```

运行 npm run check、npm run build，再手工访问应用的 #/bonus。离页重新进入时，草稿重新取 Store 已提交值；刷新会新建应用，内存 Store 不自动持久化。保存恢复见 [资源与服务](application-services.md)。

## 模板表达式与三文件规则

| 写法                                            | 用途                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `{{ score }}`                                   | 文本插值，自动读 signal/computed，不解释 HTML            |
| `:disabled="!valid"`                            | DOM property；aria-/data- 按 attribute 写入              |
| `:class="classes"`                              | 字符串、字符串数组或布尔映射                             |
| `@click="submit()"`                             | 公开操作调用；$event 是类型化事件/输出负载               |
| `model:value="draft"`                           | 可写 signal/适配器；不能绑定 computed 或只读 Store.state |
| `<template when="visible">`                     | 条件分支，退出销毁所属组件和监听                         |
| `<template each="item of items" key="item.id">` | 稳定唯一键列表，重排复用、移除销毁                       |
| `<slot name="actions">`                         | 子组件插槽，父级用 template slot="actions" 投影          |

TS 中 camelCase 的输入/输出在 HTML 使用 kebab-case，如 remainingSeconds → :remaining-seconds。组件须静态列在 components 中。模板不是任意 JavaScript：成员方法调用、赋值、类型断言、全局访问等不能直接写入表达式；例如先在 setup 暴露 formatScore(score)，再在模板调用 formatScore(score)。所有逻辑都放 TS，模板只引用已暴露成员。

组件工厂必须从 application 入口具名导入，定义赋给具名变量、元数据使用对象字面量。tooling 自动关联同名 HTML 与 CSS/Less，也支持静态 templateUrl/styleUrl；同名 CSS 与 Less 同时存在需明确选择。不要手写编译器拥有的 $template/$bindings 等字段。CSS/Less 选择器有组件作用域；全局基础样式由 main.ts 导入，主题变量见服务教程。插件处理配套文件热更新时会整页重建，不承诺保留内存状态。

## 路由参数与加载

CLI 生成的 bonus 路由本身无需手工再加一次。新增带参数页面时，路由声明形如下面的**片段**，页面也必须声明对应 required input：

```ts
// 放入 defineRoutes([...])；LevelPage 由业务定义。
// { name:'level', path:'/level/:levelId',
//   prepare:({params}) => ({levelId:params.levelId}),
//   loadPage:() => import('../pages/level/level-page.js').then(m=>m.LevelPage) }
```

页面用 context.route() 读当前位置，用 context.router.push({name:'level',params:{levelId:'one'}}) 导航。prepare 的返回对象才是页面 inputs，不会把全部参数自动传进页面。导航返回 committed/redirected/cancelled/denied/failed，应按 status 处理，不把“Promise 已完成”当作成功。

默认 hash 模式；history 模式在 AppConfig.router 配置 mode:'history' 和可选 base，并在静态宿主上配置 index.html 回退。测试可注入 createMemoryHistoryDriver，无需浏览器。

loadPage 动态导入形成懒分块；preload 只加载代码，不执行 guards/prepare/setup。显式 router.preload(target) 与自动预加载不同：自动 intent/idle 需要路由 opt-in，受保护链会跳过。RouteLink 的 focus/pointerenter 对 preload:'intent' 的目标触发意图预加载；idle 还需 router.idle.targets 配置。不要在模块顶层创建 Engine、资源传输或声音设备。

## 响应式、异步与清理

signal 保存普通数据只读快照，set/update 替换值；computed 按需缓存、追踪实际分支，只计算展示结果。computed 不做请求、不写依赖。effect(callback, context.scope) 用于同步外部能力，并可在回调内登记清理；effect 与生命周期回调必须同步。事件操作可以异步，但 await 后应检查 context.signal.aborted 和请求代次。

Store 异步操作可使用 context.runTask(async task => {...}, {key:'load'})。在 task.commit(() => 同步写入) 中提交；同 key 替换、reset 或 dispose 会取消旧任务，旧结果无法再 commit。取消不保证任意底层 Promise 停止，也不会阻止业务绕过 task.commit 直接写入。不要用 async effect 或任意 setTimeout 掩盖状态竞态。

nextTick 只等响应式/视图批次，不等网络或下一游戏帧。batch 中写入立即可读，外部通知合并；它不是可回滚事务。

生命周期为 setup → onInit → 子 onMount → 父 onMount；后续有 onInputsChanged、onBeforeUpdate/onUpdated、onDeactivate/onActivate，退出调用 onDestroy 并清理 Scope。元素 ref 从 onMount 起用 context.element/context.on 访问，监听用 context.own 登记释放。当前将 setup 写在使用 context.exposed 的钩子前，以避开已记录的推断限制。组件停用、游戏暂停和销毁是不同操作。

更多参数及类型见 [应用 API 索引](application-api.md)，详细契约见 [组件规格](../specs/component-model.md)、[Store 规格](../specs/state-store.md)、[路由规格](../specs/page-router.md)。
