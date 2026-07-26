# 移动端下行语音音质修复验证（2026-07-26）

## 用户可见问题

Android 端已经可以稳定完成至少五轮昔涟语音对话，但手机听到的角色回复比桌面端明显更糊，并伴随较强的沙声和噪声。

## 已确认根因

GPT-SoVITS 当前输出 32 kHz 单声道 PCM16 WAV。旧的移动下行链路在发布给 LiveKit 前，复用了面向 ASR 的线性插值函数并强制转换成 16 kHz。对于 32 kHz 到 16 kHz 的精确二比一转换，该算法实际退化为每隔一个采样点取一个，没有低通抗混叠滤波。

用 32 kHz、10 kHz 正弦信号复现时，旧实现把超出 16 kHz 音频奈奎斯特频率的成分折返为响亮的 6 kHz 假信号：

- 旧实现输出 RMS：约 `-4.95 dBFS`
- LiveKit/SoX `VERY_HIGH` 输出 RMS：约 `-95.54 dBFS`
- 抑制差：约 `90.59 dB`

因此，旧链路不仅丢失了昔涟音色的高频细节，还会主动制造可听的折返噪声。

## 实施范围

- `prepareWavForLiveKit` 改用 `@livekit/rtc-node` 已提供的 `AudioResampler`。
- 重采样质量使用 SoX `VERY_HIGH`，不新增外部运行时。
- 移动下行发布采样率由 16 kHz 改为 48 kHz 单声道。
- LiveKit 发布帧保持 20 ms，每帧由 320 个采样点改为 960 个采样点。
- 不改动手机麦克风、ASR、E2EE、控制面、通话生命周期或 Android `voiceCommunication` 音频模式。
- Android 1.0.9 build 10 无需重新安装；修复由桌面发布端生效。

## 自动验证

### 回归测试

`src/main/mobile-call/pcm-wav.test.ts`：

- 验证 WAV 转换公开入口输出 48 kHz 单声道 PCM。
- 验证 32 kHz 输入中的有效 10 kHz 成分在 48 kHz 输出中得到保留，不再折返成 6 kHz 假噪声。

`src/main/mobile-call/livekit-voice-bridge.test.ts`：

- 验证 `AudioSource` 使用 48 kHz 单声道。
- 验证合成语音按 48 kHz、20 ms、每帧 960 个采样点发布。

### 真实昔涟音频

对一段 6.82 秒的当前昔涟 GPT-SoVITS 输出执行真实转换：

| 指标 | 32 kHz 输入 | 48 kHz 输出 |
| --- | ---: | ---: |
| 时长 | 6.82 秒 | 6.82 秒 |
| 峰值 | -3.31 dBFS | -3.39 dBFS |
| RMS | -21.58 dBFS | -21.58 dBFS |

时长误差为 0，未出现异常增益或削波。

### 工程验证

- 定向测试：15/15 通过。
- 完整测试：219 个测试文件、1305/1305 通过。
- `npm run build`：主进程、预加载、渲染端和技能构建全部通过。

## 真人验收结果

Owner 已使用现有 Android 1.0.9 build 10、手机 VPN 和桌面 Cyrene 完成真实手机通话验收，确认：

1. 清晰度有非常大的提升；
2. 沙声已经消失；
3. 移动端音色与桌面端听起来一致；
4. 多轮通话、手机收音和角色语音回复保持正常。

该结果证明当前个人双向通话场景不需要切换 Android `media` 音频模式。后续同步或重构必须保留 LiveKit/SoX `VERY_HIGH`、48 kHz 单声道和 20 ms/960 samples 发布回归；若再次出现持续沙声或音色明显变糊，应优先检查是否回退到旧 16 kHz 简单降采样路径。
