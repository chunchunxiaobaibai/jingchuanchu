# 原生 TS 项目约束实施计划

依据用户已确认的 [规格](../docs/development/project-structure-spec.md)，按契约 → 模板 → 结构检查 → 分发消费的顺序实施。保持引擎公开接口及 0.4.0 版本，不修改 my-game。

先验证检查器能拒绝具体违规，再重构模板并验证正常项目通过。通过模板内 check/build 执行结构及类型检查；通过独立项目静态构建验证分发中的检查器可独立使用。不启动浏览器。

HTML 使用 parse5，CSS 使用 PostCSS 与 selector parser，TS 使用已有 TypeScript AST。模板和开发工具声明所需开发依赖；运行包不增加依赖。

任务清单见 [todo](todo.md)。
