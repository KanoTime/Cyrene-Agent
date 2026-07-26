#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This installer supports Apple Silicon macOS only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASR_ROOT="${CYRENE_QWEN3_ASR_ROOT:-$HOME/Documents/local-llms/qwen3-asr-1.7b}"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "$PYTHON_BIN was not found. Install Python 3.12 or set PYTHON_BIN." >&2
  exit 1
fi

mkdir -p "$ASR_ROOT/model" "$ASR_ROOT/worker" "$ASR_ROOT/logs" "$ASR_ROOT/fixtures"
"$PYTHON_BIN" -m venv "$ASR_ROOT/.venv"
"$ASR_ROOT/.venv/bin/python" -m pip install --upgrade pip
"$ASR_ROOT/.venv/bin/python" -m pip install -r "$SCRIPT_DIR/asr/requirements-macos.lock"
"$ASR_ROOT/.venv/bin/hf" download mlx-community/Qwen3-ASR-1.7B-8bit --local-dir "$ASR_ROOT/model"
cp "$SCRIPT_DIR/asr/asr_worker.py" "$ASR_ROOT/worker/asr_worker.py"
chmod +x "$ASR_ROOT/worker/asr_worker.py"

if [[ ! -f "$ASR_ROOT/fixtures/zh_short.wav" ]]; then
  tmp_aiff="$(mktemp -t cyrene-asr).aiff"
  trap 'rm -f "$tmp_aiff"' EXIT
  say -v Tingting -o "$tmp_aiff" "你好，我是昔涟。"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$tmp_aiff" "$ASR_ROOT/fixtures/zh_short.wav"
fi

"$ASR_ROOT/.venv/bin/python" -m pip check
echo "Qwen3-ASR is installed at: $ASR_ROOT"
echo "Worker: $ASR_ROOT/worker/asr_worker.py"
echo "Model:  $ASR_ROOT/model"
