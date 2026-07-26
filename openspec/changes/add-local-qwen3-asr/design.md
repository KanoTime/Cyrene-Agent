# Design: local Qwen3 ASR

## Architecture

Electron main owns a `LocalAsrWorkerManager`. It spawns the dedicated Python interpreter with stdio JSON-lines RPC. Stdio is preferred over HTTP because it has no listening socket, gives Electron direct lifecycle ownership, and makes orphan prevention and request cancellation explicit.

The Python worker preloads one local MLX model, then accepts:

- `health`
- `transcribe` with a WAV path and language
- `cancel`
- `shutdown`

Raw PCM is accumulated in TypeScript, normalized/resampled to 16 kHz mono PCM16, written to an application temporary WAV file, and submitted to the worker. Temporary files are removed in `finally` blocks.

## ASR abstraction

All engines implement lifecycle-compatible operations: `start`, `sendAudio`, `finish`, `stop`, `dispose`, plus partial/final/error callbacks. Aliyun remains streaming; local ASR returns only a final sentence in v1.

`transcribePcm` is the shared one-shot entry point used by calls and WeChat.

## Reliability

- One in-flight local inference at a time; concurrent requests receive an explicit busy error.
- Per-request timeout and cancellation terminate the non-interruptible MLX inference process, then the next request starts a clean worker.
- Worker exit rejects pending requests and permits one automatic restart on the next request.
- Electron exit sends graceful shutdown, then force-terminates after one second only if needed.
- Model path is fixed and local-only; worker uses offline environment flags.
- No inference runs synchronously on the Electron main thread.

## Compatibility

Aliyun credentials remain stored untouched when switching to local. The existing VAD, call renderer, TTS dispatcher and WeChat Silk decoder remain in place.
