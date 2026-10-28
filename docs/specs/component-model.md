# component-model：组件、模板与绑定

公共规则见 [SPEC](../../SPEC.md)。新增 runtime/component.ts、template.ts、models.ts 与 application 入口；保留旧 view.ts 的公开行为。编译实现位于 tooling，依赖此处契约。

## 定义和实例

```ts
const NicknameEditor = defineComponent({
  selector: 'nickname-editor',
  inputs: { label: input<string>({ default: '昵称' }) },
  outputs: { save: output<string>() },
  models: { value: model<string>({ default: '' }) },
  setup(context) {
    const valid = computed(() => context.models.value().trim().length > 0);
    return {
      label: context.inputs.label,
      value: context.models.value,
      valid,
      save: () => context.emit('save', context.models.value()),
    };
  },
});
```

input/output/model 是类型化定义描述，不持有共享实例状态。input 支持 required 或 default；对象默认值必须用工厂。setup 在初始输入就绪后创建本实例的 signal/派生/操作，返回对象是模板可见范围。组件不能自动读取根 AppState、任意全局变量或 Engine。

input 的默认 mode:'value' 沿用可克隆纯数据快照；显式 input<T>({required:true,mode:'reference'}) 用于场景定义、驱动配置等含函数/宿主能力的描述。reference 按 Object.is 比较并保留原引用，不克隆、不深冻结；替换引用才触发更新，调用方负责引用内部生命周期。字段读取仍只读，onInputsChanged 的字段表冻结但该字段保持原引用，输入替换/回滚也保留身份。对象默认值继续要求工厂。该模式仅用于 input，不改变 model、普通 signal/computed 的纯数据约束，也不提供隐式对象内部响应式。

inputs 为只读信号；emit(name,payload) 根据 outputs 检查名称和负载。models 是“值输入＋更新请求”契约：绑定父级时 setter 请求父级写入，最终值仍由父级决定；未绑定时可使用本实例默认值。输入与 model 不能同名。definePage 使用同一组件定义模型，增加路由页面身份；普通组件不因定义了 selector 就成为路由。

context 提供 own、signal、element(ref)、on、useStore/useService。服务获取必须来自当前实例的明确 owner，不使用隐式全局当前实例。实例提供 setInputs、activate、deactivate、dispose；公共输入与组件输出类型必须保留。

context.element/on 在挂载前不可用。setup 返回的字段是模板公开成员；输入/输出/model 的 TS 名称采用 camelCase，模板组件属性/事件采用 kebab-case 并按声明映射，冲突须诊断，不能依赖浏览器把大小写转换后猜名字。

单组件嵌入入口为 mountComponent(host, definition, {owner?, inputs?, outputs?, models?, onError?})，返回类型化 exposed、setInputs、activate/deactivate/dispose。models 中的可写目标由父级拥有，组件只经该目标请求更新；绑定后不能再用 setInputs 旁路覆盖该 model。未绑定的 model 使用自己的初始值。节点引用使用 ref="name"。T04 完成挂载和所有权，T06 提供表达式/属性/事件，T07 提供 model，T08 提供 when/each/key/slot 与 nextTick。应用、Store 和路由仍按各自任务实现。

## 默认模板语法

以下是新模型唯一默认绑定语法的示例片段，不是上方组件的完整模板；旧 data-* 语法仅由旧 defineView 管线继续支持。

```html
<label>{{ label }}</label>
<input model:value="value" />
<button :disabled="!valid" @click="save()">保存</button>
<template when="valid"><span>可以提交</span></template>
<template each="item of items" key="item.id"><span>{{ item.name }}</span></template>
<slot name="actions"><span>默认操作区</span></slot>
```

- 插值默认 textContent；:name 用于单向绑定，value/checked/disabled 等按 DOM property 更新，aria/data 等按 attribute 更新。:class 支持字符串、字符串数组或布尔映射，不能通过它逃逸组件样式作用域。
- @event 调用公开操作，可读类型化 $event；禁止模板赋值、任意脚本、eval 和全局访问。表达式支持已公开成员、字面量、属性读取、常用运算和公开函数调用，由 TS AST 编译，不在运行时用 Function 执行字符串。
- model:name 只接受可写 signal/model 或显式 writableModel({get,set}) 适配。computed、只读 input 或普通只读 Store 字段作为目标必须报错；Store setter 应调用业务操作。
- `writableModel({get,set,convert?,event?})` 将业务操作适配为可写目标；数值/多选需显式 `convert: 'number'/'strings'`，提交时机可选 `input`（默认）或 `change`。返回值提供只读 `draft`/`validation` 与 `resetDraft()`；空值/解析失败不写入业务数值，显式重置恢复模型值。布尔原生绑定使用 `model:checked`，多选使用 select 的 `model:value`。同一字段不能并用 `:value` 与 `model:value`。
- 原生 input/textarea/select 支持字符串、数值、布尔和多选数组；转换与 input/change 时机由显式 model 配置定义。空数字或解析失败保留草稿及校验结果，不强制为 0。中文组合输入、光标与焦点不被回写破坏；程序回写不再发用户更新事件。
- when 只创建命中分支，退出分支释放其组件/监听；each 必须有稳定唯一 key（字符串或有限数值），重复键在改动该列表前报错；重排复用 DOM 与组件实例，移除才销毁。列表项是只读快照，编辑通过公开业务操作完成。组件实例缓存不由 when 默认提供。
- 命名 slot 接收父模板 `<template slot="actions">` 内容，按父级词法上下文求值，DOM 挂到子组件指定位置；缺失时使用 fallback。首阶段不做动态 slot 名称或 slot props。

动态组件须赋给具名变量，components 使用静态定义数组；子定义 selector 保留字面量类型以检查注册和字段映射。原生事件的 $event.currentTarget 按标签类型化，组件事件的 $event 为声明负载。表达式首阶段支持属性读取、字面量索引、条件/常用运算及公开函数直接调用；成员方法调用、赋值、全局脚本和类型断言不进入模板语法。

编译器生成模板虚拟 TS 验证输入、事件、表达式和 model 可写性，错误映射到原 HTML 文件及行列。三文件自动关联、CSS/Less 和静态 templateUrl/styleUrl 沿用资源规则。只检查字符串名称存在不算完成。

当前 TypeScript 构造器的上下文推断存在属性顺序限制：将 `setup` 放在使用 context 的生命周期钩子之前；如需反向书写，显式指定完整定义泛型。仅给 setup 添加返回类型不能消除此限制。该限制已记录为类型体验改进项，当前默认写法使用 setup 在前。

## 生命周期和调度

setup → onInit → 创建视图和子组件 → 子 onMount → 父 onMount。初始输入不调用 onInputsChanged，初次显示不调用更新钩子。后续输入合并 previous/current；实际 DOM 更新前/后才调用 onBeforeUpdate/onUpdated，父准备、子更新、父完成。钩子同步；钩子内写入进入下一批。

onDeactivate/onActivate 由显式停用/恢复触发，不等同游戏暂停。销毁顺序为子实例 → 自身 onDestroy → 自动清理 → 移除自身节点；异常聚合后报告，必要清理继续。实例退出取消异步任务；已销毁实例不能复活或写状态。

## 直接验收

C1：多个实例的输入/model/局部状态隔离；父子生命周期与批处理次序正确。

C2：原生表单和自定义组件 model 双向同步，中文输入及程序重置不回环。

C3：条件退出、keyed 重排、slot 父作用域和销毁后订阅释放有直接用例。

C4：错误输入/事件/model 由模板类型诊断定位；旧 defineView 消费例仍通过。

测试：tests/component-runtime.test.ts、tests/component-template.test.ts、类型 fixture。Node DOM 验证行为，浏览器焦点/输入法体验另列人工验收，不声称 Node 模拟已证明设备行为。
