# 应用开发套件实施计划

依据 project-structure-spec.md 及本轮“完善完整应用开发套件与代码生成脚手架”的授权实施。保留既有包与入口，不迁移外部游戏、不发布。

| 模块      | 责任                                         | 依赖                                  |
| --------- | -------------------------------------------- | ------------------------------------- |
| app-state | 不可变展示快照、类型化命令及作用域           | core                                  |
| app-view  | 实例化、父子输入、绑定、全部生命周期与销毁   | app-state、core                       |
| app-game  | 场景定义、输入、挂载与应用清理               | app-view、core/scenes、browser、input |
| tooling   | 三文件关联、CSS/Less 作用域、诊断、Vite 监听 | app 的编译资源契约                    |
| scaffold  | create/generate 与四类项目、本地分发         | tooling、app-game                     |

运行时新增 @xiaobaibaifqy/jingchuanchu-app；开发工具新增 @xiaobaibaifqy/jingchuanchu-tooling。构建顺序：状态 → 视图 → 应用 → 编译器 → 生成器 → 模板/分发。

绑定语法使用 data-text="绑定名"、data-attr-title="绑定名"、data-on-click="动作名" 与 data-ref。绑定函数、动作和父子输入在 TS 中定义并检查类型，HTML 只引用静态名称，编译器检查名称。动态文本使用 textContent。组件样式编译为每实例标记约束的选择器，子组件内部不接收父组件标记；动画名同时重命名。Less 先编译，再处理作用域和 source map。

所有八个 UI 钩子均实现，停用显式通过实例 activate/deactivate 控制；暂停游戏不停用 UI。状态与输入更新按 microtask 批处理，生命周期内产生的变化留到下一批。使用 Node DOM 模拟库测试，不启动浏览器。

脚手架拒绝覆盖非空目录/已有文件；生成组件默认自动加入指定父组件的 components 引用，生成场景自动加入 defineGame.scenes。create 支持 core/singleplayer/client/server，CSS/Less 可选，--bundle 指定本地分发套件，复制 tgz 到项目 vendor，默认不自动安装或启动服务。

完成条件：针对状态/类型、生命周期/隔离/清理、场景与输入、编译错误/Less、生成项目和 tgz 独立消费提供直接验证；新模板静态构建通过；文档明确迁移步骤和实际验证范围。
