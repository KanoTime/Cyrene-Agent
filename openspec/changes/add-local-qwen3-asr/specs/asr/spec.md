# ASR capability delta

## ADDED Requirements

### Requirement: Local sentence ASR

Cyrene SHALL transcribe completed utterances with a locally installed Qwen3-ASR model without requiring cloud credentials.

#### Scenario: local call utterance

- GIVEN `asrEngine=local` and the worker is ready
- WHEN VAD ends an utterance
- THEN Cyrene awaits the final transcript before entering THINKING
- AND passes that transcript to the configured chat model

### Requirement: Persistent isolated worker

The local model SHALL run in a dedicated environment and persistent worker owned by Electron.

#### Scenario: repeated recognition

- WHEN ten utterances are recognized sequentially
- THEN the model is loaded once
- AND no model download is attempted

#### Scenario: worker failure

- WHEN the worker exits unexpectedly
- THEN the pending operation fails with a clear error
- AND a later operation can restart the worker automatically

### Requirement: Shared WeChat transcription

Decoded WeChat voice SHALL use the same unified PCM transcription service as calls.

#### Scenario: non-16k audio

- WHEN decoded voice has a supported non-16k sample rate
- THEN it is resampled before local recognition instead of being rejected solely for sample rate

## MODIFIED Requirements

### Requirement: ASR settings

The local option SHALL display model path, installation/load status and a test action. Aliyun credentials SHALL remain hidden but preserved while local is selected. The UI SHALL state that v1 returns final sentences and does not provide live partial captions.
