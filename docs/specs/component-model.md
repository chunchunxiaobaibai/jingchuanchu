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

inputs 为只读信号；emit(name,payload) 根据 outputs 检查名称和负载。models 是“值输入＋更新请求”契约：绑定父级时 setter 请求父级写入，最终值仍由父级决定；未绑定时可使用本实例默认值。输入与 model 不能同名。definePage 使用同一组件定义模型，增加路由页面身份；普通组件不因定义了 selector 就成为路由。

context 提供 own、signal、element(ref)、on、useStore/useService。服务获取必须来自当前实例的明确 owner，不使用隐式全局当前实例。实例提供 setInputs、activate、deactivate、dispose；公共输入与组件输出类型必须保留。

context.element/on 在挂载前不可用。setup 返回的字段是模板公开成员；输入/输出/model 的 TS 名称采用 camelCase，模板组件属性/事件采用 kebab-case 并按声明映射，冲突须诊断，不能依赖浏览器把大小写转换后猜名字。

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
- 原生 input/textarea/select 支持字符串、数值、布尔和多选数组；转换与 input/change 时机由显式 model 配置定义。空数字或解析失败保留草稿及校验结果，不强制为 0。中文组合输入、光标与焦点不被回写破坏；程序回写不再发用户更新事件。
- when 只创建命中分支，退出分支释放其组件/监听；each 必须有稳定唯一 key，重排复用实例，移除才销毁。组件实例缓存不由 when 默认提供。
- 命名 slot 接收父模板 `<template slot="actions">` 内容，按父级词法上下文求值，DOM 挂到子组件指定位置；缺失时使用 fallback。首阶段不做动态 slot 名称或 slot props。

编译器生成模板虚拟 TS 验证输入、事件、表达式和 model 可写性，错误映射到原 HTML 文件及行列。三文件自动关联、CSS/Less 和静态 templateUrl/styleUrl 沿用资源规则。只检查字符串名称存在不算完成。

## 生命周期和调度

setup → onInit → 创建视图和子组件 → 子 onMount → 父 onMount。初始输入不调用 onInputsChanged，初次显示不调用更新钩子。后续输入合并 previous/current；实际 DOM 更新前/后才调用 onBeforeUpdate/onUpdated，父准备、子更新、父完成。钩子同步；钩子内写入进入下一批。

onDeactivate/onActivate 由显式停用/恢复触发，不等同游戏暂停。销毁顺序为子实例 → 自身 onDestroy → 自动清理 → 移除自身节点；异常聚合后报告，必要清理继续。实例退出取消异步任务；已销毁实例不能复活或写状态。

## 直接验收

C1：多个实例的输入/model/局部状态隔离；父子生命周期与批处理次序正确。

C2：原生表单和自定义组件 model 双向同步，中文输入及程序重置不回环。

C3：条件退出、keyed 重排、slot 父作用域和销毁后订阅释放有直接用例。

C4：错误输入/事件/model 由模板类型诊断定位；旧 defineView 消费例仍通过。

测试：tests/component-runtime.test.ts、tests/component-template.test.ts、类型 fixture。Node DOM 验证行为，浏览器焦点/输入法体验另列人工验收，不声称 Node 模拟已证明设备行为。
