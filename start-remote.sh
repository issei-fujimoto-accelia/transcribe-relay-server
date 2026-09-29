#!/usr/bin/env bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# 第1引数に設定ファイルパスが指定されていれば優先、なければ remote.env を使用
CONFIG_FILE="${1:-$PROJECT_ROOT/remote.env}"

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "\033[31m✘ Error: Config file not found at $CONFIG_FILE\033[0m"
  echo "Usage: ./start-remote.sh [path/to/custom.env]"
  exit 1
fi

echo -e "\033[36m▶ Loading configuration from: $CONFIG_FILE\033[0m"
# 設定変数を読み込み＆環境変数としてエクスポート
set -a
source "$CONFIG_FILE"
set +a

# 終了時ハンドラ
cleanup() {
  echo -e "\n\033[1;33m[Shutting down relay server...]\033[0m"
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  echo -e "\033[1;32m[Relay server stopped.]\033[0m"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo -e "\033[1;34m=== Checking Remote GPU Services ===\033[0m"

# 1. リモート Whisper 疎通チェック (HTTP 8080)
echo -n "Checking Whisper service at $WHISPER_API_URL ... "
if curl -s --connect-timeout 3 "$WHISPER_API_URL" > /dev/null 2>&1 || [ $? -eq 52 ]; then
  echo -e "\033[32m✔ OK\033[0m"
else
  echo -e "\033[31m✘ FAILED\033[0m"
  echo "Warning: Could not connect to remote Whisper server. Please ensure the service is running and firewall allows port 8080."
fi

# 2. リモート Ollama 疎通チェック (HTTP 11434)
OLLAMA_BASE_URL=$(echo "$OLLAMA_API_URL" | sed 's#/api/generate##')
echo -n "Checking Ollama service at $OLLAMA_BASE_URL ... "
if curl -s --connect-timeout 3 "$OLLAMA_BASE_URL/api/tags" > /dev/null 2>&1; then
  echo -e "\033[32m✔ OK\033[0m"
else
  echo -e "\033[31m✘ FAILED\033[0m"
  echo "Warning: Could not connect to remote Ollama server. Please ensure Ollama is bound to 0.0.0.0 and firewall allows port 11434."
fi

# 3. ローカル中継サーバーの起動
SERVER_DIR="$PROJECT_ROOT/server"
if [ ! -d "$SERVER_DIR" ]; then
  echo -e "\033[31m✘ Error: server directory not found at $SERVER_DIR\033[0m"
  exit 1
fi

echo -e "\n\033[36m▶ Starting local TypeScript relay server (Port: ${WSS_PORT:-3000})...\033[0m"
cd "$SERVER_DIR"
npm start &
NODE_PID=$!

echo -e "\n\033[1;32m====================================================\033[0m"
echo -e "\033[1;32m Relay server running! Press Ctrl+C to stop.       \033[0m"
echo -e "\033[1;32m====================================================\033[0m\n"

wait "$NODE_PID"
