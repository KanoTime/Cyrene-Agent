# Tasks

- [x] Establish dirty-worktree and port-8080 baseline.
- [x] Create isolated ASR venv and pin verified dependencies.
- [x] Download the 1.7B-8bit model once to the fixed local model directory.
- [x] Implement and benchmark the persistent Python worker.
- [x] Implement worker manager, PCM/WAV utilities and unified ASR interface/factory.
- [x] Refactor call manager to await `finish()` and make turn ending idempotent/cancellable.
- [x] Route WeChat decoded voice through the unified transcription service with resampling.
- [x] Implement local ASR settings/status/test IPC and renderer UI.
- [x] Add unit/integration/recovery tests.
- [x] Validate model corpus, ten sequential requests, timeout, cancel and crash restart.
- [x] Validate Cyrene call sequencing and WeChat Silk/resampling/local-ASR code paths without disturbing Qwen3.5-9B.
- [x] Record performance, memory, ports and cleanup evidence.
- [ ] User acoustic check: speak into the real microphone through VAD → final ASR → LLM.
- [ ] User real-channel check: send one WeChat voice message and confirm reply dispatch.
- [ ] Configure an available TTS engine and confirm audible playback in the real call window.
