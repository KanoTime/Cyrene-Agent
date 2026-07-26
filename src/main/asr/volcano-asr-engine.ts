// 阿里云实时语音识别 ASR 引擎 —— WebSocket + JSON 协议。
//
// 文档：https://help.aliyun.com/zh/isi/developer-reference/websocket
// URL：wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=<token>
// 鉴权：用 AccessKeyId + AccessKeySecret 获取临时 token，拼到 URL 里
// 协议：JSON 文本帧（StartTranscription/StopTranscription）+ 二进制帧（PCM 音频）
// 音频：PCM 16kHz/16bit/mono

import { WebSocket } from "ws";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { AsrConfig } from "./types";

const LOG_PREFIX = "[AliyunASR]";
const NLS_GATEWAY = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";

/** 阿里云 ASR 流式识别会话 */
export class VolcanoAsrStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private audioBuffer = Buffer.alloc(0);
  private taskId = randomUUID().replace(/-/g, "");
  private appKey = "";
  private completedResolve: (() => void) | null = null;
  private completedReject: ((error: Error) => void) | null = null;
  private readonly completed = new Promise<void>((resolve, reject) => {
    this.completedResolve = resolve;
    this.completedReject = reject;
  });
  private startedResolve: (() => void) | null = null;
  private startedReject: ((error: Error) => void) | null = null;
  private readonly started = new Promise<void>((resolve, reject) => {
    this.startedResolve = resolve;
    this.startedReject = reject;
  });

  constructor(
    private readonly onPartial: (text: string) => void,
    private readonly onFinal: (text: string) => void,
    private readonly onError: (error: Error) => void = () => {},
  ) {}

  /** 开始识别会话：获取 token → 连 WebSocket → 发 StartTranscription */
  async start(appKey: string, accessKeyId: string, accessKeySecret: string, language: string): Promise<void> {
    this.appKey = appKey;
    console.log(LOG_PREFIX, `获取 token... appKey=${appKey}`);
    let token: string;
    try {
      token = await this.getToken(accessKeyId, accessKeySecret);
    } catch (err) {
      console.error(LOG_PREFIX, "获取 token 失败:", err);
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError(error);
      this.completedReject?.(error);
      throw error;
    }
    console.log(LOG_PREFIX, "token 获取成功，连接 WebSocket...");

    const url = `${NLS_GATEWAY}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(LOG_PREFIX, "WS 已连接，发送 StartTranscription");
      this.sendStartTranscription(appKey, language);
    });

    this.ws.on("message", (raw: Buffer) => this.handleMessage(raw));
    this.ws.on("error", (err) => {
      console.error(LOG_PREFIX, "WS 错误:", err.message);
      this.onError(err);
      this.completedReject?.(err);
      this.startedReject?.(err);
    });
    this.ws.on("close", (code) => {
      console.log(LOG_PREFIX, `WS 关闭: ${code}`);
      if (this.stopped) this.completedResolve?.();
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.started,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("阿里云 ASR 启动超时")), 10_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 发送 StartTranscription 指令（JSON 文本帧） */
  private sendStartTranscription(appKey: string, language: string): void {
    const langMap: Record<string, string> = { zh: "zh-CN", en: "en-US" };
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StartTranscription",
        appkey: appKey,
      },
      payload: {
        format: "pcm",
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        max_sentence_silence: 800,
      },
    };
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch (err) {
      console.error(LOG_PREFIX, "发送 StartTranscription 失败:", err);
    }
  }

  /** 发送一帧 PCM 音频（攒够 200ms/6400 字节再发） */
  sendAudio(pcmFrame: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.stopped) return;
    this.audioBuffer = Buffer.concat([this.audioBuffer, pcmFrame]);
    // 200ms = 16000 * 0.2 * 2 = 6400 字节
    while (this.audioBuffer.length >= 6400) {
      const chunk = this.audioBuffer.subarray(0, 6400);
      this.audioBuffer = this.audioBuffer.subarray(6400);
      this.ws.send(chunk, { binary: true });
    }
  }

  /** 结束识别：发剩余音频 + StopTranscription */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 发剩余音频
    if (this.audioBuffer.length > 0) {
      try { this.ws.send(this.audioBuffer, { binary: true }); } catch { /* ignore */ }
      this.audioBuffer = Buffer.alloc(0);
    }

    // 发 StopTranscription 指令
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StopTranscription",
        appkey: this.appKey,
      },
    };
    try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }

    setTimeout(() => { try { this.ws?.close(); } catch { /* ignore */ } }, 2000);
  }

  /** 正常结束并等待服务端发出 TranscriptionCompleted，避免最终文本竞态。 */
  async finish(timeoutMs = 8_000): Promise<void> {
    this.stop();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.completed,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("阿里云 ASR 完成超时")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 解析服务端 JSON 响应 */
  private handleMessage(raw: Buffer): void {
    try {
      const msg = JSON.parse(raw.toString()) as {
        header?: {
          status?: number;
          status_text?: string;
          task_id?: string;
          name?: string;
        };
        payload?: {
          result?: string;
          index?: number;
          time?: number;
          confidence?: number;
        };
      };

      const status = msg.header?.status;
      const eventName = msg.header?.name;

      if (status !== 20000000 && status !== undefined) {
        const error = new Error(`ASR 错误: status=${status}, msg=${msg.header?.status_text}`);
        console.error(LOG_PREFIX, error.message);
        this.onError(error);
        this.completedReject?.(error);
        return;
      }

      if (eventName === "TranscriptionStarted") {
        console.log(LOG_PREFIX, "转写已开始，可以发送音频");
        this.startedResolve?.();
      } else if (eventName === "TranscriptionResultChanged") {
        // 中间结果
        const text = msg.payload?.result ?? "";
        if (text) this.onPartial(text);
      } else if (eventName === "SentenceEnd") {
        // 最终结果
        const text = msg.payload?.result ?? "";
        if (text) {
          console.log(LOG_PREFIX, "最终识别:", text);
          this.onFinal(text);
        }
      } else if (eventName === "TranscriptionCompleted") {
        console.log(LOG_PREFIX, "转写已完成");
        this.completedResolve?.();
      }
    } catch (err) {
      console.error(LOG_PREFIX, "解析响应失败:", err);
    }
  }

  /** 用 AccessKeyId + AccessKeySecret 获取阿里云临时 token */
  private async getToken(accessKeyId: string, accessKeySecret: string): Promise<string> {
    // 阿里云 NLS token 获取：RPC 风格 API 签名
    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: "CreateToken",
      Format: "JSON",
      RegionId: "cn-shanghai",
      SignatureMethod: "HMAC-SHA256",
      SignatureNonce: randomUUID().replace(/-/g, ""),
      SignatureVersion: "1.0",
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      Version: "2019-02-28",
    };

    // 按字母序排列参数
    const sortedKeys = Object.keys(params).sort();
    const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");

    // 构建签名字符串
    const stringToSign = `GET&%2F&${encodeURIComponent(canonicalQuery)}`;

    // HMAC-SHA256 签名（阿里云签名附加 &）
    const signature = createHmac("sha256", accessKeySecret + "&")
      .update(stringToSign)
      .digest("base64");

    // 构建完整 URL
    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${canonicalQuery}&Signature=${encodeURIComponent(signature)}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { Token?: { Id?: string }; errmsg?: string };
    if (!data.Token?.Id) throw new Error(data.errmsg || "token 获取失败");
    return data.Token.Id;
  }
}

// ── 配置注入 ──

let asrConfigGetter: (() => AsrConfig | null) | null = null;

export function setAsrConfig(getter: () => AsrConfig | null): void {
  asrConfigGetter = getter;
}

export function getAsrConfig(): AsrConfig | null {
  return asrConfigGetter?.() ?? null;
}
