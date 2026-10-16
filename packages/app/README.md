# @xiaobaibaifqy/jingchuanchu-app

镜川初可选应用运行时。提供 defineGame、defineScene、defineInput、defineView、bootstrapGame、mountGame 与组件实例生命周期。核心引擎用户不必安装本包。

```ts
import { defineGame, defineView, bootstrapGame } from '@xiaobaibaifqy/jingchuanchu-app';
interface State {
  score: number;
}
interface Commands {
  reset: undefined;
}
const Root = defineView<State, Commands>({
  selector: 'game-app',
  text: { score: (context) => context.state.score },
  actions: { reset: (context) => context.commands.send('reset', undefined) },
});
const game = defineGame<State, Commands>({
  state: () => ({ score: 0 }),
  setup(context) {
    context.commands.handle('reset', () => context.state.update(() => ({ score: 0 })));
  },
});
const app = await bootstrapGame(Root, game);
// app.dispose();
```

Root 同目录同名的 TS/HTML/CSS 或 Less 由 tooling 的 Vite 插件自动关联，不能直接把未编译定义传给 mountGame。HTML 使用 data-text、data-attr-_、data-on-_ 和 data-ref；文本写入 textContent，不解释为 HTML。

组件提供 onInit/onMount/onInputsChanged/onBeforeUpdate/onUpdated/onActivate/onDeactivate/onDestroy。钩子同步执行，实例隔离 local/inputs；setLocal、state 更新与 setInputs 按微任务批处理。通过 viewInputs(Child, props, 可选ref) 在 childInputs 中提供受类型检查的子组件属性。组件仅接收只读展示数据和命令，不接收 Engine/World。

展示状态只接受可 structuredClone 的普通对象、数组与原始值；更新使用 state.update(previous => 新对象)。输入由 defineInput.initial/read/setup 管理，read 每个固定步采样，暂停清空键状态；场景命令在暂停时丢弃，应用命令保持可用。setup 登记的指针监听可用 enabled() 遵守相同策略。

本地 0.4.0 尚未发布 npm。完整示例与迁移说明见仓库 docs/development/application-suite.md。MIT，见 LICENSE。
