#!/usr/bin/env python3
"""Persistent local Qwen3-ASR worker using newline-delimited JSON over stdio."""

from __future__ import annotations

import argparse
import json
import os
import queue
import resource
import sys
import threading
import time
import traceback
import wave
from pathlib import Path
from typing import Any

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

DEFAULT_ROOT = Path(
    os.environ.get("CYRENE_QWEN3_ASR_ROOT")
    or Path.home() / "Documents" / "local-llms" / "qwen3-asr-1.7b"
).expanduser()
DEFAULT_MODEL = DEFAULT_ROOT / "model"
DEFAULT_LOG = DEFAULT_ROOT / "logs" / "worker.log"

_write_lock = threading.Lock()
_log_lock = threading.Lock()


def emit(payload: dict[str, Any]) -> None:
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    line = f"{stamp} {message}\n"
    with _log_lock:
        DEFAULT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with DEFAULT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(line)
    sys.stderr.write(line)
    sys.stderr.flush()


def rss_bytes() -> int:
    # macOS reports ru_maxrss in bytes; Linux reports KiB.
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if sys.platform == "darwin" else value * 1024


def inspect_wav(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"audio file not found: {path}")
    try:
        with wave.open(str(path), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frames = wav.getnframes()
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"invalid WAV: {exc}") from exc
    if channels != 1 or sample_width != 2 or sample_rate != 16000:
        raise ValueError(
            f"worker requires 16kHz/16bit/mono WAV, got "
            f"{sample_rate}Hz/{sample_width * 8}bit/{channels}ch"
        )
    return {
        "channels": channels,
        "sampleWidth": sample_width,
        "sampleRate": sample_rate,
        "frames": frames,
        "durationSec": frames / sample_rate if sample_rate else 0.0,
    }


def normalize_language(value: Any) -> str | None:
    raw = str(value or "auto").strip().lower()
    if raw in {"zh", "zh-cn", "chinese", "中文"}:
        return "Chinese"
    if raw in {"en", "en-us", "english", "英文"}:
        return "English"
    if raw in {"auto", "", "none"}:
        return None
    raise ValueError(f"unsupported language: {value}")


class Worker:
    def __init__(self, model_path: Path) -> None:
        self.model_path = model_path
        self.model: Any = None
        self.loaded_at = 0.0
        self.load_time_sec = 0.0
        self.busy_id: str | None = None
        self.cancelled: set[str] = set()
        self.jobs: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

    def load(self) -> None:
        if not self.model_path.is_dir():
            raise FileNotFoundError(f"model directory not found: {self.model_path}")
        started = time.perf_counter()
        from mlx_audio.stt import load

        self.model = load(self.model_path)
        self.load_time_sec = time.perf_counter() - started
        self.loaded_at = time.time()
        log(f"model ready path={self.model_path} load={self.load_time_sec:.3f}s rss={rss_bytes()}")

    def status(self) -> dict[str, Any]:
        return {
            "ready": self.model is not None,
            "busy": self.busy_id is not None,
            "busyRequestId": self.busy_id,
            "modelPath": str(self.model_path),
            "loadTimeSec": self.load_time_sec,
            "loadedAt": self.loaded_at,
            "rssBytes": rss_bytes(),
            "pid": os.getpid(),
        }

    def submit(self, req_id: str, params: dict[str, Any]) -> None:
        if self.busy_id is not None or not self.jobs.empty():
            emit({"id": req_id, "ok": False, "error": {"code": "busy", "message": "ASR worker is busy"}})
            return
        self.jobs.put((req_id, params))

    def cancel(self, target_id: str) -> bool:
        if not target_id:
            return False
        self.cancelled.add(target_id)
        return self.busy_id == target_id

    def run_jobs(self) -> None:
        while True:
            item = self.jobs.get()
            if item is None:
                return
            req_id, params = item
            self.busy_id = req_id
            started = time.perf_counter()
            try:
                audio_path = Path(str(params.get("audioPath") or ""))
                info = inspect_wav(audio_path)
                if info["frames"] == 0:
                    result = {
                        "text": "",
                        "language": [],
                        "durationSec": 0.0,
                        "elapsedSec": 0.0,
                        "rtf": 0.0,
                        "rssBytes": rss_bytes(),
                    }
                else:
                    language = normalize_language(params.get("language"))
                    output = self.model.generate(
                        str(audio_path),
                        language=language,
                        temperature=0.0,
                        max_tokens=int(params.get("maxTokens") or 512),
                        verbose=False,
                        system_prompt=str(params.get("systemPrompt") or "").strip() or None,
                    )
                    elapsed = time.perf_counter() - started
                    duration = float(info["durationSec"])
                    result = {
                        "text": str(getattr(output, "text", "")).strip(),
                        "language": getattr(output, "language", None),
                        "durationSec": duration,
                        "elapsedSec": elapsed,
                        "rtf": elapsed / duration if duration > 0 else 0.0,
                        "rssBytes": rss_bytes(),
                        "promptTokens": int(getattr(output, "prompt_tokens", 0) or 0),
                        "generationTokens": int(getattr(output, "generation_tokens", 0) or 0),
                    }
                cancelled = req_id in self.cancelled
                self.cancelled.discard(req_id)
                self.busy_id = None
                if cancelled:
                    log(f"discarded cancelled result id={req_id}")
                else:
                    emit({"id": req_id, "ok": True, "result": result})
            except Exception as exc:
                cancelled = req_id in self.cancelled
                self.cancelled.discard(req_id)
                self.busy_id = None
                if not cancelled:
                    emit(
                        {
                            "id": req_id,
                            "ok": False,
                            "error": {"code": "transcribe_failed", "message": str(exc)},
                        }
                    )
                log(f"transcribe failed id={req_id}: {exc}\n{traceback.format_exc()}")
            finally:
                self.busy_id = None
                self.jobs.task_done()


def run_server(model_path: Path) -> int:
    worker = Worker(model_path)
    try:
        worker.load()
    except Exception as exc:
        emit({"event": "fatal", "error": {"code": "load_failed", "message": str(exc)}})
        log(f"model load failed: {exc}\n{traceback.format_exc()}")
        return 2

    emit({"event": "ready", "result": worker.status()})

    def read_requests() -> None:
        for raw in sys.stdin:
            req_id = ""
            try:
                req = json.loads(raw)
                req_id = str(req.get("id") or "")
                method = str(req.get("method") or "")
                params = req.get("params") if isinstance(req.get("params"), dict) else {}
                if not req_id:
                    raise ValueError("request id is required")
                if method == "health":
                    emit({"id": req_id, "ok": True, "result": worker.status()})
                elif method == "transcribe":
                    worker.submit(req_id, params)
                elif method == "cancel":
                    target = str(params.get("requestId") or "")
                    emit({"id": req_id, "ok": True, "result": {"accepted": worker.cancel(target)}})
                elif method == "shutdown":
                    emit({"id": req_id, "ok": True, "result": {"shuttingDown": True}})
                    worker.jobs.put(None)
                    return
                else:
                    emit({"id": req_id, "ok": False, "error": {"code": "method_not_found", "message": method}})
            except Exception as exc:
                emit({"id": req_id, "ok": False, "error": {"code": "bad_request", "message": str(exc)}})
        worker.jobs.put(None)

    reader = threading.Thread(target=read_requests, name="asr-ipc-reader", daemon=True)
    reader.start()
    # MLX GPU work must stay on the process main thread on macOS.
    worker.run_jobs()
    return 0


def run_once(model_path: Path, audio_path: Path, language: str, system_prompt: str | None) -> int:
    worker = Worker(model_path)
    worker.load()
    info = inspect_wav(audio_path)
    started = time.perf_counter()
    output = worker.model.generate(
        str(audio_path),
        language=normalize_language(language),
        temperature=0.0,
        max_tokens=512,
        verbose=False,
        system_prompt=system_prompt,
    )
    elapsed = time.perf_counter() - started
    emit(
        {
            "ok": True,
            "result": {
                "text": str(getattr(output, "text", "")).strip(),
                "language": getattr(output, "language", None),
                "durationSec": info["durationSec"],
                "elapsedSec": elapsed,
                "rtf": elapsed / info["durationSec"] if info["durationSec"] else 0.0,
                "loadTimeSec": worker.load_time_sec,
                "rssBytes": rss_bytes(),
            },
        }
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--once", type=Path)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--system-prompt")
    args = parser.parse_args()
    if args.once:
        return run_once(args.model, args.once, args.language, args.system_prompt)
    return run_server(args.model)


if __name__ == "__main__":
    raise SystemExit(main())
