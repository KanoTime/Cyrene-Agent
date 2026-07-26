# Change: add local Qwen3 ASR on macOS

## Why

Cyrene exposes `asrEngine=local` in settings, but the option is only a placeholder. The call path only accepts Aliyun and reads final text immediately after stopping the stream, while inbound WeChat voice reports local ASR as configured but still rejects every non-Aliyun engine.

## What Changes

- Deploy `mlx-community/Qwen3-ASR-1.7B-8bit` in an isolated Python environment outside the existing Qwen3.5 environment.
- Add a persistent, localhost-only MLX ASR worker with ready, health, transcribe, cancel and shutdown operations.
- Add a unified ASR engine interface and factory while retaining the Aliyun adapter.
- Make calls await final sentence recognition before entering the LLM/TTS phase.
- Reuse the same PCM transcription service for decoded WeChat voice, including resampling.
- Replace the local ASR placeholder UI with model/install/load/test status.
- Add unit, integration, recovery and performance verification.

## Out of Scope

- Token-by-token streaming partial captions on macOS.
- Replacing the existing Qwen3.5-9B service on port 8080.
- Replacing Aliyun ASR.
- Search, maps, Feishu or game-bot work.

## Success Criteria

The local 1.7B model loads once, transcribes representative audio repeatedly, survives cancellation/timeouts/restart, drives the call state machine and WeChat voice path, persists across Cyrene restarts, binds no LAN interface, leaves no orphan process, and does not disturb port 8080.
