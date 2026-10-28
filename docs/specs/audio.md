# audio：背景音乐、音效与音量

公共规则见 [SPEC](../../SPEC.md)。位置：runtime/audio.ts；通过 asset-loading 取得音频资源，浏览器能力使用可注入 AudioDriver。

实现进度：T25 的 AudioDriver 契约与内部 mixer 已实现，3 项注入测试验证解锁/音量/静音/应用 scope 退出；类型化资源键共享解码子步骤也已通过；内部 playMusic/playEffect 已验证结果、替换与并发策略；app.audio 公开装配已通过，T25 自动项完成；T26 的页面/场景 owner facade 与退出隔离已验证，T26 的 owner 隔离、自动/手动暂停、页面/场景/后台接线与外部偏好恢复自动项均已通过。没有真实 AudioContext 或设备播放结果。

## 驱动与混音核心

AudioDriver.unlock 同步进入驱动方法、异步返回 locked/ready/suspended，以保留业务真实用户交互中的解锁机会；内部 mixer 合并进行中的 unlock，返回 ready/blocked(reason)/failed(AudioError)/cancelled。解锁失败允许显式重试；dispose 立即结算等待，忽略晚到结果。公开契约还声明 decode(ArrayBuffer,signal)、start(decoded,{loop,gain,onEnded})、release(decoded)、close，以及 voice 的 setGain/pause/resume/stop；解码与播放已由内部服务接线，浏览器能力仍由显式 Driver 提供。

混音偏好为深只读 volumes(master/music/effects) 与 muted；最终增益是 master × 对应分组，静音时为 0，但保留音量。内部 attach 登记已存在 voice 并应用当前增益，后续设置更新全部附着 voice；该操作本身不启动播放，也不代表播放成功。detach 后不再更新该 voice，所属播放句柄继续负责停止；mixer dispose 停止仍附着的 voice，默认关闭自有 driver，ownsDriver:false 保留外部共享驱动。source/group/key/cause 用于实际驱动错误诊断。偏好存储及暂停原因在后续 owner 层实现。

## 音频资源持有（内部）

AudioClipCache.load(assets,group,key,signal) 只接受 AssetGroup 中 kind:audio 的键；真实 AssetContext lease 保留原字节，解码缓存以 ArrayBuffer 身份合并进行中与已完成持有。driver.decode 收到一次独立字节副本及共享解码取消信号，避免消费/转移原始资产数据。每次 load 返回独立只读 decoded/release 句柄；单方退出不影响其他持有，最后一方退出释放 decoded 与原资产引用。

取消立即结算等待；忽略取消的 decoder 晚到时释放一次，失败移除持有后允许新批次重试。已释放句柄读取报 AudioError，并清掉自身字节/记录引用。错误带 group/key/operation/cause，释放阶段的异步路径诊断交给观察者。该层仍为内部入口，不启动播放或等候音效队列。

## 播放控制（内部）

AudioService.playMusic/playEffect(group,audioKey,{loop?}) 只接受音频键。结果为 played(playback)/blocked(reason)/failed(AudioError)/cancelled；played 表示 Driver.start 已返回有效 voice，不表示已在真实设备验证可听。locked/suspended/failed 状态阻止播放；effects 达到上限时依策略阻止或移除最旧请求，不加载被阻止请求，不排队。偏好 mute 使 gain 为 0，仍与播放启动结果独立。

music 默认循环、effects 默认不循环，loop 可显式覆盖。music 新请求取消旧的待启动请求，已播放旧轨在新轨启动成功后才退休；替换失败保留旧轨。effects 默认最多 16 个请求，配置 maxEffects 与 effectPolicy:drop-new（默认）/drop-oldest；等待解码或 start 的请求也占名额，避免异步请求突破上限。

playback 提供只读 state(playing/paused/stopped/ended) 与 stop；自然结束不再调用 stop，但注销混音并释放 clip。pauseMusic/resumeMusic 只改变当前音乐，不覆盖静音。退出立即结算 decode/start 等待，晚到 voice 停止一次；晚到 decoded 由 clip cache 回收，异步清理错误有资源来源。此层仍需后续应用配置/owner facade 装配。

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

## 已实现的应用入口

defineApplication({root,assets,audio:{driver:()=>AudioDriver,ownsDriver?,maxEffects?,effectPolicy?}}) 按应用创建一次驱动与混音/解码/播放服务；audio 依赖已配置的 assets。driver 工厂必须同步返回完整驱动，不隐式创建全局 AudioContext；非法配置在调用工厂前拒绝，非法返回/根挂载失败回滚自有驱动。外部共享驱动用 ownsDriver:false。

配置后 app.audio 为 AudioControls：state/preferences 只读，提供 unlock/playMusic/playEffect/pauseMusic/resumeMusic/setVolume/setMuted/restorePreferences。未配置时 app.audio=undefined。解锁仍由业务用户交互显式调用；播放操作返回状态结果，资源或启动失败不假装成功。应用退出先停止播放，再释放解码/原始 lease，最后关闭自有驱动；组件/场景 owner 入口已接入各自 lease，不借用应用根 lease 代替 owner 隔离。

定向验证见 tests/application-audio.test.ts，使用真实应用挂载与注入 Driver/Voice；未验证实际 AudioContext、设备声音或后台恢复。

## 已实现的 owner 入口

配置应用 audio 后，组件 context.audio 和场景 context.audio 取得同一个应用服务下的 owner facade；未配置时按需读取会报缺少音频上下文，纯逻辑场景不因此创建服务。app.audio 归应用 owner，组件与每次场景实例各自持有资源 lease、请求取消和 voice。

owner 取消或 Scope 退出会结算其 pending 播放、停止其 voice、释放引用并注销每请求订阅；不会停止其他 owner。已持有的 facade.state 返回 disposed，后续播放返回 cancelled，设置操作拒绝已退出 owner。音乐仍为应用单轨，新请求按既有替换策略处理，但 pauseMusic/resumeMusic 只控制该 owner 的音乐；总音量和静音是应用共享偏好。owner 共用解码/并发上限，不各建独立 AudioService。

页面/场景/后台的独立暂停原因与完整偏好恢复已接通；Node 生命周期检查不表示实际后台设备恢复已验收。

## 暂停与偏好核心

内部 owner 有效态切为不活动时，pending 请求与音效结算/停止，不积压恢复队列；已播放音乐保留 clip 并调用 voice.pause。重新活动仅恢复没有手动暂停标记的音乐，不恢复旧音效。pauseMusic 的手动标记与自动标记独立；自动暂停期间 resumeMusic 不会使 voice 提前恢复，自动恢复也不会抹掉手动暂停。facade 在 driver ready 但 owner 不活动时 state=suspended，新播放 blocked:suspended，且不加载资源。

AudioControls.restorePreferences({volumes:{master,music,effects},muted}) 完整校验后一次提交应用共享偏好并应用 gain；非法值不改变原偏好，输入按数据复制。该方法不读写存储，供保存模块/业务显式恢复。

有效态已接入生命周期：ComponentOwner 的本地活动态与父活动态取交集，deactivate/activate 更新本地态；手动 scene owner 继承页面活动，同时由场景 onPause/onResume 控制自己的本地态。应用 document.visibility 作为另一个独立后台条件。Provider 组合这些条件后再同步音频有效态，重新可见不覆盖页面/场景停用。监听按需订阅父链并在 owner 退出注销；首次在隐藏/停用状态读取 audio 立即受阻，无恢复播放队列。Node 检查不等于后台设备恢复验证。


## 参考游戏浏览器适配进度（T43b）

参考模板 app/web-audio-driver.ts 已提供符合现有 AudioDriver 的惰性 Web Audio 实现。只有显式 unlock 构造 AudioContext 并同步进入 resume；decode 不主动解锁，取消或退出后晚到解码不登记为可播放资源。每个 voice 用独立 GainNode，暂停保存偏移并停止一次性 BufferSource，恢复重建；循环偏移取模，旧结束回调不结束新 source。自然结束/stop/close 断开节点，close 幂等并结算等待解码。

app/asset-transport.ts 复用图片适配并增加可取消 fetch 音频字节，检查 HTTP 状态并在完成后注销取消订阅。此适配已在后续子步骤接入 AppConfig 和试听按钮，见下文；T43b 尚未完成。注入 AudioContext/节点/fetch 的定向测试3/3及TS检查通过，未创建真实上下文，不作为设备播放或浏览器后台恢复证据。


T43b 资源与交互试听：GameSounds提供原创正弦合成collect/complete/timeout三份短PCM WAV，仓库脚本可确定性生成，许可说明随参考素材保存。默认AppConfig现启用组合transport与Web Audio驱动；页面“启用并试听声音”在实际事件调用栈同步进入unlock，ready后才取资源/播放，区分受限/失败/加载/启动与静音。未解锁不积压音效；退出停止所属试听。游戏事件与反馈在后续子步骤接入，见下文。

修正一个接入时发现的问题：mixer不再因曾经ready而永久跳过driver.unlock；每次明确解锁可重新询问原生上下文，只有pending调用合并，支持后台原生挂起后的再次交互恢复。直接回归覆盖ready→suspended→ready；原公开方法/签名未改。相关混音/驱动7/7、最终游玩/应用音频4/4及模板/TS/静态构建通过，全部使用注入环境，真实音频解锁和后台设备表现仍未验证。


T43b 自动项已完成：收集音效由scene owner持有，暂停/重开/退出停止；通关/超时提示音用仍活动的游戏页owner，避免完成暂停立即取消提示音。页面按run和请求代次处理异步结果，旧结果不改新局提示，晚到voice主动停止，重开清旧页面提示音。声音受限/失败/取消均与已启动区分，静音单独显示；失败不阻塞玩法。clock.tween收集脉冲跟随场景暂停/恢复，不改变碰撞尺寸。最终游玩/场景定向5/5及模板/TS检查通过；自然通关只发一次结束回调、超时停帧后页面提示音启动与重开停止均使用注入环境，真实浏览器/设备仍未验收。
