import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pcm16MonoToWav, resamplePcm16Mono } from "./pcm-utils";
import type { AsrConfig, PcmAudio } from "./types";

const DEFAULT_ROOT = path.join(os.homedir(), "Documents", "local-llms", "qwen3-asr-1.7b");
const DEFAULT_PROMPT = "以下是语音转写。请忠实转写，不要改写，也不要添加未听见的内容。";

export function buildLocalAsrSystemPrompt(
  globalPrompt: string | undefined,
  hints: readonly string[] = [],
): string {
  const base = globalPrompt?.trim() || DEFAULT_PROMPT;
  if (hints.length === 0) return base;
  return `${base}\n可能出现以下专有名词：${hints.join("、")}。只在确实听到时按此拼写，不得添加未听见内容。`;
}

interface WorkerReply {
  id?: string;
  event?: string;
  ok?: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

export interface LocalAsrStatus {
  installed: boolean;
  ready: boolean;
  loading: boolean;
  pid?: number;
  modelPath: string;
  rootPath: string;
  loadTimeSec?: number;
  rssBytes?: number;
  error?: string;
}

export interface LocalTranscriptionResult {
  text: string;
  durationSec: number;
  elapsedSec: number;
  rtf: number;
  rssBytes: number;
}

export class LocalAsrWorkerManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private pending = new Map<string, PendingRequest>();
  private stdoutBuffer = "";
  private lastStatus: LocalAsrStatus | null = null;
  private lastError = "";
  private disposed = false;

  isBusy(): boolean {
    return this.pending.size > 0 || Boolean(this.readyPromise);
  }

  async start(config: AsrConfig): Promise<void> {
    await this.ensureWorker(config);
  }

  async getStatus(config: AsrConfig, startWorker = false): Promise<LocalAsrStatus> {
    const paths = this.resolvePaths(config);
    const installed = await this.isInstalled(...this.requiredInstallPaths(paths));
    if (startWorker && installed) {
      try { await this.ensureWorker(config); } catch (error) { this.lastError = toError(error).message; }
    }
    return {
      installed,
      ready: Boolean(this.child && this.lastStatus?.ready),
      loading: Boolean(this.child && !this.lastStatus?.ready),
      pid: this.child?.pid,
      modelPath: paths.modelPath,
      rootPath: paths.rootPath,
      loadTimeSec: this.lastStatus?.loadTimeSec,
      rssBytes: this.lastStatus?.rssBytes,
      error: this.lastError || undefined,
    };
  }

  async transcribe(audio: PcmAudio, config: AsrConfig, signal?: AbortSignal): Promise<LocalTranscriptionResult> {
    await this.ensureWorker(config);
    if (signal?.aborted) throw new Error("本地 ASR 已取消");
    const normalized = resamplePcm16Mono(audio.pcm, audio.sampleRate);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cyrene-asr-"));
    const wavPath = path.join(tempDir, "audio.wav");
    await fs.writeFile(wavPath, pcm16MonoToWav(normalized));
    try {
      const result = await this.request(
        "transcribe",
        {
          audioPath: wavPath,
          language: config.language,
          systemPrompt: buildLocalAsrSystemPrompt(config.localSystemPrompt, config.speechRecognitionHints),
        },
        config.localTimeoutMs ?? 30_000,
        signal,
        true,
      );
      return {
        text: String(result.text ?? "").trim(),
        durationSec: Number(result.durationSec ?? 0),
        elapsedSec: Number(result.elapsedSec ?? 0),
        rtf: Number(result.rtf ?? 0),
        rssBytes: Number(result.rssBytes ?? 0),
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async health(config: AsrConfig): Promise<LocalAsrStatus> {
    await this.ensureWorker(config);
    const result = await this.request("health", {}, 5_000);
    this.updateStatus(result);
    return this.getStatus(config);
  }

  async shutdown(timeoutMs = 1_500): Promise<void> {
    this.disposed = true;
    const child = this.child;
    const error = new Error("本地 ASR Worker 已关闭");
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
      this.pending.delete(id);
    }
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(forceTimer);
        child.off("exit", finish);
        resolve();
      };
      child.once("exit", finish);
      const killTimer = setTimeout(() => {
        if (this.child === child && !child.killed) this.killWorker(error);
      }, Math.min(1_000, timeoutMs));
      const forceTimer = setTimeout(finish, timeoutMs);

      if (!child.killed) {
        try {
          child.stdin.write(`${JSON.stringify({ id: randomUUID(), method: "shutdown", params: {} })}\n`);
        } catch {
          this.killWorker(error);
        }
      }
    });
  }

  dispose(): void {
    void this.shutdown();
  }

  private resolvePaths(config: AsrConfig) {
    const rootPath = config.localRoot?.trim() || DEFAULT_ROOT;
    return {
      rootPath,
      pythonPath: path.join(rootPath, ".venv", "bin", "python"),
      workerPath: path.join(rootPath, "worker", "asr_worker.py"),
      modelPath: config.localModelPath?.trim() || path.join(rootPath, "model"),
    };
  }

  private async isInstalled(...pathsToCheck: string[]): Promise<boolean> {
    try {
      await Promise.all(pathsToCheck.map((filePath) => fs.access(filePath)));
      return true;
    } catch {
      return false;
    }
  }

  private requiredInstallPaths(paths: ReturnType<LocalAsrWorkerManager["resolvePaths"]>): string[] {
    return [
      paths.pythonPath,
      paths.workerPath,
      paths.modelPath,
      path.join(paths.modelPath, "config.json"),
      path.join(paths.modelPath, "model.safetensors"),
      path.join(paths.modelPath, "tokenizer_config.json"),
    ];
  }

  private async ensureWorker(config: AsrConfig): Promise<void> {
    if (this.disposed) this.disposed = false;
    if (this.child && this.lastStatus?.ready) return;
    if (this.readyPromise) return this.readyPromise;

    const paths = this.resolvePaths(config);
    if (!(await this.isInstalled(...this.requiredInstallPaths(paths)))) {
      throw new Error(`本地 ASR 未完整安装：${paths.rootPath}`);
    }
    this.lastError = "";
    this.lastStatus = { installed: true, ready: false, loading: true, rootPath: paths.rootPath, modelPath: paths.modelPath };
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const child = spawn(paths.pythonPath, [paths.workerPath, "--model", paths.modelPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CYRENE_QWEN3_ASR_ROOT: paths.rootPath,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
      },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => console.log("[LocalASR]", chunk.trim()));
    child.on("error", (error) => this.onWorkerExit(error, child));
    child.on("exit", (code, signal) => this.onWorkerExit(new Error(`本地 ASR Worker 退出 (${code ?? signal ?? "unknown"})`), child));

    const loadTimer = setTimeout(() => this.killWorker(new Error("本地 ASR 模型加载超时")), 60_000);
    try {
      await this.readyPromise;
    } finally {
      clearTimeout(loadTimer);
      this.readyPromise = null;
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        try { this.onMessage(JSON.parse(line) as WorkerReply); }
        catch (error) { this.killWorker(new Error(`本地 ASR 协议错误: ${toError(error).message}`)); }
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private onMessage(message: WorkerReply): void {
    if (message.event === "ready" && message.result) {
      this.updateStatus(message.result);
      this.readyResolve?.();
      return;
    }
    if (message.event === "fatal") {
      this.killWorker(new Error(message.error?.message || "本地 ASR 加载失败"));
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.cleanup?.();
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result ?? {});
    else pending.reject(new Error(message.error?.message || "本地 ASR 请求失败"));
  }

  private updateStatus(result: Record<string, unknown>): void {
    if (!this.lastStatus) return;
    this.lastStatus = {
      ...this.lastStatus,
      ready: Boolean(result.ready),
      loading: false,
      pid: Number(result.pid || this.child?.pid || 0) || undefined,
      loadTimeSec: Number(result.loadTimeSec ?? 0),
      rssBytes: Number(result.rssBytes ?? 0),
    };
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
    killOnInterrupt = false,
  ): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child || child.killed || !this.lastStatus?.ready) return Promise.reject(new Error("本地 ASR Worker 未就绪"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const failAndMaybeKill = (message: string) => {
        const error = new Error(message);
        if (killOnInterrupt) this.killWorker(error);
        else reject(error);
      };
      const timer = setTimeout(() => failAndMaybeKill("本地 ASR 识别超时"), timeoutMs);
      const onAbort = () => failAndMaybeKill("本地 ASR 已取消");
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  private onWorkerExit(error: Error, source?: ChildProcessWithoutNullStreams): void {
    // 被取消/超时的旧进程可能在新 Worker 已启动后才送达 exit；不能误伤新进程。
    if (source && source !== this.child) return;
    if (!this.child && !this.readyPromise) return;
    this.lastError = error.message;
    this.child = null;
    this.lastStatus = this.lastStatus ? { ...this.lastStatus, ready: false, loading: false, error: error.message } : null;
    this.readyReject?.(error);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private killWorker(error: Error): void {
    const child = this.child;
    this.onWorkerExit(error);
    if (child && !child.killed) child.kill("SIGKILL");
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export const localAsrWorker = new LocalAsrWorkerManager();
