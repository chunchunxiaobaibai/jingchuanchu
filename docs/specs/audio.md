# audio：背景音乐、音效与音量

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/audio.ts；通过 asset-loading 取得音频资源，浏览器能力使用可注入 AudioDriver。

## 契约

应用提供 AudioService，暴露 unlock、playMusic、playEffect、pauseMusic、resumeMusic、setVolume、setMuted 及只读状态。资源按类型化音频键引用；master/music/effects 三组音量为 0..1，静音与音量分别保存。

unlock 必须由开发者绑定到真实用户交互调用。音频系统区分 locked、ready、suspended、failed、disposed；locked 时播放返回 blocked 结果，不把未播放说成成功，也不无限积压等待音效。解锁后背景音乐是否重启由业务显式决定。

应用可共享解码缓存，但每个页面/场景通过 Scope 持有播放句柄。退出停止该 owner 的声音；背景页暂停与手动静音分别记录，恢复不取消手动静音。背景音乐默认单轨替换，音效可以并发，应用配置明确并发限制与丢弃策略。

播放/解码失败包含资源键与 cause；释放最后一个音频引用后回收解码资源。dispose 停止播放、取消等待并关闭属于本应用的 AudioContext；外部传入的共享 Driver 是否关闭由所有权选项决定。

保存音量/静音由 save-data 的偏好记录负责，音频模块不自行写 localStorage。首阶段不实现音频编辑器、空间音频、节奏同步或跨页自动音乐编排。

## 直接验收

U1：注入 Driver 验证 locked/解锁/静音/分组音量及播放失败；拒绝的播放没有挂起队列。

U2：页面退出停止自己的声音，不影响另一个 owner；应用退出释放其上下文。

U3：暂停恢复保留手动静音，音量偏好可从外部恢复。

测试：tests/audio.test.ts。真实浏览器首次播放、手机后台恢复与音量体验是人工验收项，Node 模拟不代替这些结论。
