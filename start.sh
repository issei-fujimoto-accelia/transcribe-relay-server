#!/usr/bin/env bash

set -e

# プロジェクトルートの絶対パスを取得
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# パス設定（環境に合わせて必要に応じて調整してください）
WHISPER_DIR="/Users/ac297/mysrc/whisper.cpp"
WHISPER_BIN=${WHISPER_DIR}/build/bin/whisper-server
WHISPER_MODEL=${WHISPER_DIR}/models/ggml-base.en.bin
SERVER_DIR="$PROJECT_ROOT/server"

# 終了時のクリーンアップ処理（バックグラウンドプロセスを確実にKILL）
cleanup() {
  echo -e "\n\033[1;33m[Shutting down all services...]\033[0m"
  if [ -n "$WHISPER_PID" ] && kill -0 "$WHISPER_PID" 2>/dev/null; then
    kill "$WHISPER_PID" 2>/dev/null || true
  fi
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  # Ollamaプロセスをこのスクリプトで起動していた場合のみ終了
  if [ -n "$OLLAMA_PID" ] && kill -0 "$OLLAMA_PID" 2>/dev/null; then
    kill "$OLLAMA_PID" 2>/dev/null || true
  fi
  echo -e "\033[1;32m[All services stopped.]\033[0m"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo -e "\033[1;34m=== Starting Local Transcription & Translation Services ===\033[0m"

# 1. Ollama の確認と起動
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo -e "\033[32m✔ Ollama is already running on port 11434.\033[0m"
else
  echo -e "\033[36m▶ Starting Ollama service...\033[0m"
  ollama serve > /dev/null 2>&1 &
  OLLAMA_PID=$!

  # 起動待機
  until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do
    sleep 0.5
  done
  echo -e "\033[32m✔ Ollama started successfully.\033[0m"
fi

# 2. whisper.cpp サーバーの起動
if [ ! -f "$WHISPER_BIN" ]; then
  echo -e "\033[31m✘ Error: whisper-server binary not found at $WHISPER_BIN\033[0m"
  exit 1
fi
if [ ! -f "$WHISPER_MODEL" ]; then
  echo -e "\033[31m✘ Error: Model not found at $WHISPER_MODEL\033[0m"
  exit 1
fi

echo -e "\033[36m▶ Starting whisper.cpp server (Port: 8080, Model: base.en)...\033[0m"
"$WHISPER_BIN" -m "$WHISPER_MODEL" --port 8080 --language en > /dev/null 2>&1 &
WHISPER_PID=$!

# ポート8080のヘルスチェック
until curl -s http://localhost:8080/inference > /dev/null 2>&1 || [ $? -eq 52 ]; do
  sleep 0.5
done
echo -e "\033[32m✔ whisper.cpp server is ready on port 8080.\033[0m"

# 3. Node.js WebSocket サーバー (server.ts) の起動
if [ ! -d "$SERVER_DIR" ]; then
  echo -e "\033[31m✘ Error: server directory not found at $SERVER_DIR\033[0m"
  exit 1
fi

echo -e "\033[36m▶ Starting TypeScript relay server (Port: 3000)...\033[0m"
cd "$SERVER_DIR"
npm start &
NODE_PID=$!

echo -e "\n\033[1;32m====================================================\033[0m"
echo -e "\033[1;32m All pipelines running! Press Ctrl+C to stop all.   \033[0m"
echo -e "\033[1;32m====================================================\033[0m\n"

# Nodeプロセスの終了待機
wait "$NODE_PID"
