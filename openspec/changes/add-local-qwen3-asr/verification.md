# Verification evidence

Date: 2026-07-15, Apple M5 / 32 GiB / macOS.

## Deployment

- Root: `$HOME/Documents/local-llms/qwen3-asr-1.7b`
- Model: `mlx-community/Qwen3-ASR-1.7B-8bit`, fixed local copy, 2.3 GiB on disk.
- Largest weight file: `model.safetensors`, 2,463,307,541 bytes.
- Venv: 521 MiB, independent from Qwen3.5-9B.
- Pins: `mlx-audio==0.4.5`, `mlx==0.32.0`, `mlx-lm==0.31.3`, `transformers==5.12.1` (full freeze in `scripts/asr/requirements-macos.lock`).
- `pip check`: no broken requirements.
- Worker uses stdio only and sets Hugging Face/Transformers offline mode.

## Model and worker

Persistent corpus report: `$HOME/Documents/local-llms/qwen3-asr-1.7b/logs/benchmark.json`.

| Fixture | Audio | Inference | RTF | Result |
| --- | ---: | ---: | ---: | --- |
| Chinese/proper noun | 1.68 s | 0.39 s | 0.23 | `你好，我是昔涟。` |
| English | 3.08 s | 0.47 s | 0.15 | correct |
| Mixed/Qwen3.5 | 4.09 s | 0.65 s | 0.16 | correct |
| Date/amount | 6.67 s | 0.81 s | 0.12 | correct content |
| Typical long sentence | 12.00 s | 1.12 s | 0.09 | correct |
| Long | 25.47 s | 2.35 s | 0.09 | correct |
| Silence/noise/empty | 3/3/0 s | <=0.30 s | <=0.10 | empty text |
| Corrupt WAV | n/a | n/a | n/a | explicit invalid-WAV error |

- Load time: 0.93 s in the persistent benchmark.
- Ten consecutive short transcriptions: all correct, 0.36–0.40 s each, one PID/model load.
- Worker RSS after the corpus: 2.71 GB.
- Real settings-page test: `你好，我是昔涟。`, 0.42 s, RTF 0.23.
- Cancel, timeout and unexpected `SIGKILL`: pending request rejected; next health/request starts a new ready worker.
- Graceful Electron exit: no ASR process remains and no resource-cleanup warning.

## Integration

- Build: main, preload and renderer all pass.
- Targeted tests pass for PCM/WAV, local worker, call sequencing, WeChat adapter, and 24 kHz Silk → decode → resample → local ASR.
- Call state observed in the real app after restart: `ASR` → `LISTENING`; microphone access was available without a permission error.
- Local selection, paths, prompt and language persisted across a real app restart.
- Call unit integration proves duplicate `turnEnd` is ignored, `finish()` is awaited, final ASR text becomes the last user message to the 8080 request, then TTS is invoked.
- The WeChat adapter now uses the same `transcribePcm` service for local and Aliyun; existing inbound dispatch tests still pass.

## Coexistence

- Qwen3.5-9B binds `127.0.0.1:8080`; the ASR worker opens no listening socket.
- With both models loaded: Qwen worker footprint 5,970 MB + ASR footprint 2,507 MB = about 8.48 GB combined process footprint.
- System memory free reported 71% during the repeated coexistence run.
- 12.00 s ASR while Qwen was loaded: 0.75 s, RTF 0.063; a following Qwen request returned `并存正常` and port 8080 remained HTTP 200.
- One earlier pre-existing 8080 process disappeared before the first footprint capture. The original command was restored exactly, and a controlled repeat (load both, infer with both, recheck port) did not reproduce the failure. The restored service remains running.

## Known external/manual evidence

- Speaker playback was not looped back into the microphone, so a person must speak one sentence for the final real acoustic/VAD result.
- A real WeChat voice message requires a human sender; automated tests cover Silk decoding, 24 kHz resampling, local inference and adapter dispatch.
- Current GPT-SoVITS settings have no reference audio/prompt and no service is listening on 9880, so audible TTS cannot pass until a TTS engine is configured.
- The `/tmp` versus `/private/tmp` test-fixture expectation on macOS has been made path-canonical; see the current CI/test result in the delivery PR.
