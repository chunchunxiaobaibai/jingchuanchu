# 参考游戏短音效

三份 WAV 是本项目用正弦波公式合成的原创提示音，无录音、外部采样或第三方音乐。版权所有：Copyright (c) 2026 Xiaobaifqy Engine contributors；按 [MIT 许可](../../../public/theme-assets-license.txt) 提供。该许可文件随 Vite 构建输出，分发时保留。

| 文件         | 用途           | 频率 / 时长                  |
| ------------ | -------------- | ---------------------------- |
| collect.wav  | 收集与启用试听 | 880 Hz，0.10秒               |
| complete.wav | 通关           | 660/880/1100 Hz，各0.12秒    |
| timeout.wav  | 超时           | 330 Hz 0.12秒，220 Hz 0.18秒 |

格式为22050 Hz、单声道、16位PCM WAV；振幅峰值不超过0.18，首尾淡入淡出以避免截断。项目脚本 scripts/generate-audio.mjs 可通过 node 执行并确定性重建这三份文件；运行项目不需要重新生成。此处不包含背景音乐。

GameSounds 使用资源类型化键与 Vite URL 引用。播放仍需明确交互解锁并遵循静音/音量设置；收集和结束事件已接入，真实设备是否可听仍需实际验收。
