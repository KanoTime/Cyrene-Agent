import { localAsrWorker } from "./local-asr-worker-manager";
import type { AsrConfig } from "./asr-config";
import { MosslandAsrStream } from "./mossland-asr-engine";
import { MiniMaxAsrStream } from "./minimax-asr-engine";
import { AliyunAsrStream } from "./aliyun-asr-engine";

export interface AsrStreamSession {
  start(): Promise<void>;
  sendAudio(frame: Buffer): void;
  stop(): void | Promise<string | void>;
}

export function createAsrStream(
  config: AsrConfig,
  onPartial: (text: string) => void,
  onFinal: (text: string) => void,
): AsrStreamSession {
  if (config.engine === "mossland") {
    return new MosslandAsrStream(config.apiKey, onFinal);
  }
  if (config.engine === "minimax") {
    return new MiniMaxAsrStream(config.apiKey, onFinal);
  }

  if (config.engine === "local") {
    let frames: Buffer[] = [];
    const controller = new AbortController();
    return {
      start: async () => { await localAsrWorker.start(config); },
      sendAudio: frame => { if (!controller.signal.aborted) frames.push(Buffer.from(frame)); },
      stop: async () => {
        const pcm = Buffer.concat(frames); frames = [];
        if (!pcm.length) { controller.abort(); return ""; }
        const result = await localAsrWorker.transcribe({ pcm, sampleRate: 16000 }, config, controller.signal);
        onFinal(result.text); return result.text;
      },
    };
  }
  const stream = new AliyunAsrStream(onPartial, onFinal);
  return {
    start: () => stream.start(
      config.appKey,
      config.accessKeyId,
      config.accessKeySecret,
      config.language,
    ),
    sendAudio: (frame) => stream.sendAudio(frame),
    stop: async () => { await stream.finish(); },
  };
}
