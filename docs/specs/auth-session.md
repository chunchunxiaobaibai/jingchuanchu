# auth-session：可选账号会话适配

公共规则及服务端边界见 [SPEC](../../SPEC.md)。位置：runtime/auth.ts；依赖应用服务和 Store，不依赖 Router。

## 契约

AuthProvider<LoginInput, User> 定义 restore(signal)、login(input,signal)、logout(signal)，返回经业务 decoder 校验的匿名/已认证结果。User 只包含展示所需身份、权限声明等最小信息，凭据交给 Provider 的请求层管理。

AuthService 提供 ensureSession、login、logout 和只读 session 状态。状态为 unknown/restoring/anonymous/authenticated/failed；并发恢复共享请求。只有 Provider 确认后才进入 authenticated，不把未知或网络失败当成功。

服务按应用实例隔离；单机应用不提供服务，不生成登录目录。示例 Provider 必须有明确后端配置和真实请求协议，不以本地 loggedIn=true 作为认证实现，也不要求框架自带账号数据库。

会话失效/切换账号递增身份代次，取消旧请求并触发已登记的 user-scoped Store 重置与页面/网络清理；旧 Promise 结果不得恢复旧身份。登出失败也立即清理本地敏感活动，同时报告服务端撤销失败，不能假称远端会话已撤销。

Cookie/令牌策略由部署适配确定。默认示例使用同源服务器会话，由后端设置安全 Cookie 并处理所需 CSRF；不在普通 Store、URL、日志或默认持久化保存凭据。具体后端地址属于业务配置，不硬编码服务商。

## 直接验收

I1：恢复去重及 unknown/anonymous/failed 区分，Provider 输出校验，单机无认证依赖。

I2：账号切换后旧请求不能写回，用户 Store 和资源清理被调用；两个应用隔离。

I3：带假后端的接入示例区分有效/过期会话及撤销失败，不只演示前端标记。

测试：tests/auth-session.test.ts，注入 Provider/请求驱动。真实后端接入由项目明确提供，不能在规格阶段宣称已完成外部身份认证。
