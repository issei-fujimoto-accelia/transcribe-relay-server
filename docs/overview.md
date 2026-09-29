# Audio Tab Transcriber & Translator: システム概要設計書

## 1. プロジェクト概要

本システムは、Web ブラウザ（Google Chrome）上で再生される動画や音声コンテンツ（ポップアップウィンドウ再生を含む）を対象に、音声データをリアルタイムにキャプチャし、ローカルまたはリモートの AI モデル基盤を用いて「英語文字起こし」および「日本語字幕翻訳」を低遅延で提供するシステムです。

OS 全体の音声ルーティング変更（仮想オーディオドライバの導入等）を不要とし、ブラウザ拡張機能と軽量なバックエンド中継基盤の連携により動作します。

---

## 2. システムアーキテクチャ

システムは大きく **「フロントエンド（Chrome 拡張機能 / パネル）」**、**「中継・オーケストレーション層（TypeScript / Node.js）」**、**「AI 推論基盤（whisper.cpp & Ollama）」** の3層で構成されます。

```text
[ Chrome Browser ]
  ├─ 対象動画タブ (Popup / 通常タブ)
  │    └─ (音声出力)
  └─ 拡張機能パネル (独立ウィンドウ / panel.html)
       ├─ navigator.mediaDevices.getDisplayMedia (音声キャプチャ)
       ├─ AudioWorklet (16kHz モノラル Linear PCM 変換)
       └─ WebSocket Client (ws://localhost:3000)
                     │
                     │ PCM Streaming (Raw Int16 ArrayBuffer)
                     ▼
[ TypeScript Relay Server (Node.js) ]
  ├─ WebSocket Server (:3000)
  ├─ 音声バッファリング & WAVヘッダー付与 (約3秒単位)
  ├─ Whisper 連携 (HTTP POST /inference)
  ├─ 文末判定バッファリング (., ?, ! 検知)
  └─ Ollama 連携 (HTTP POST /api/generate)
         │                     │
         │ (HTTP Multipart)    │ (JSON POST)
         ▼                     ▼
[ AI Inference Engine ] (ローカル Mac または 外部 GPU サーバー)
  ├─ whisper.cpp (:8080)
  │    └─ モデル: ggml-base.en.bin (英語専用認識)
  └─ Ollama (:11434)
       └─ モデル: qwen2.5:0.5b (英日字幕翻訳)

```

---

## 3. ディレクトリ構成

```text
transcriber-project/
├── extension/                     # Chrome 拡張機能 (Manifest V3)
│   ├── manifest.json              # 拡張機能マニフェスト (action, storage, resources)
│   ├── background.js              # Service Worker (アイコンクリック時の独立ウィンドウ管理)
│   ├── panel.html                 # 字幕・操作パネル UI (独立ウィンドウ)
│   ├── panel.js                   # WebSocket 制御、音声ストリーミング、字幕描画
│   └── pcm-processor.js           # AudioWorklet スレッド (Float32 -> Int16 PCM 変換)
│
├── server/                        # 中継・文脈制御サーバー
│   ├── package.json
│   ├── tsconfig.json
│   └── server.ts                  # WS 受信、バッファリング、Whisper/Ollama API オーケストレーション
│
├── whisper.cpp/                   # 音声認識エンジン (サブモジュールまたは別配置)
│   ├── build/bin/whisper-server   # ビルド済みバイナリ (Metal / CUDA 対応)
│   └── models/ggml-base.en.bin    # 英語推論モデル
│
├── start.sh                       # ローカル完結型一括起動スクリプト (Ollama, Whisper, Node)
├── start-remote.sh                # 外部 GPU サーバー接続型起動スクリプト
└── remote.env                     # 外部 GPU サーバー接続設定ファイル

```

---

## 4. コンポーネント詳細仕様

### 4.1. Chrome 拡張機能 (クライアント層)

| 項目 | 内容・仕様 |
| --- | --- |
| **マニフェスト** | Manifest V3 準拠 |
| **起動方式** | ツールバーのアイコン押下により、`chrome.windows.create` で独立ウィンドウ（`type: 'popup'`）として `panel.html` を起動（フォーカス外れによる破棄を防止）。 |
| **キャプチャ手法** | `navigator.mediaDevices.getDisplayMedia` を利用。「Chrome タブ」の選択時に「タブの音声を共有」を有効化して取得。不要な映像トラックは即座に停止。 |
| **音声処理** | `AudioContext`（サンプリングレート: 16,000Hz）および `AudioWorkletNode` を使用。オーディオスレッド上で `-1.0 〜 1.0` の Float32 を 16bit リニア PCM へ量子化し、ゼロコピー転送（ArrayBuffer）でメインスレッド経由送信。 |
| **エコー防止** | キャプチャ元タブで音声が通常出力されるため、パネル側の `audioContext.destination` への接続は行わず、二重音声を防止。 |
| **表示仕様** | 英語原文（下段・補助表示）と日本語訳文（上段・強調表示）をカード形式で逐次追記・オートスクロール表示。 |

### 4.2. 中継サーバー (`server.ts`)

| 項目 | 内容・仕様 |
| --- | --- |
| **プロトコル** | クライアント間: WebSocket（ポート 3000）<br>

<br>AI エンジン間: HTTP REST API |
| **音声バッファリング** | 受信した PCM データを蓄積し、約 3 秒分（16,000 sample/s × 2 bytes × 3s = 96,000 bytes）ごとに WAV コンテナ化して Whisper API へ送信。 |
| **無音・重複抑制** | Whisper から返却された空文字や `[BLANK_AUDIO]` トークンを検知し、後続の翻訳処理およびクライアント送信を抑止。 |
| **文末判定制御** | Whisper の出力テキストを蓄積し、文末記号（`[.?!]`）を検知したタイミング、または単語長リミット（20 単語超過）に達したタイミングで 1 文として確定・フラッシュ。 |
| **翻訳連携** | 確定した英文を Ollama API の Prompt に埋め込み、JSON POST で問い合わせ。取得した訳文と原文をペアにしてクライアントへ返却。 |

### 4.3. AI 推論基盤

| 役割 | 採用ソフトウェア | モデル | 備考 |
| --- | --- | --- | --- |
| **音声認識 (STT)** | `whisper.cpp` (`whisper-server`) | `ggml-base.en.bin` | Apple Silicon (Metal) / NVIDIA (CUDA) で低遅延動作。英語専用モデルにより軽量性と認識精度を両立。 |
| **英日翻訳 (MT)** | `Ollama` | `qwen2.5:0.5b-instruct` | メモリ消費 1GB 未満。字幕用途に最適化されたシステムプロンプト（`Output ONLY the Japanese translation...`）と `temperature: 0.1` により定型訳を出力。 |

---

## 5. 動作モードと起動方法

本システムは、すべての処理をローカル Mac 上で完結させる「ローカル完結モード」と、重い推論処理を別マシンの GPU にオフロードする「リモート GPU モード」の双方に対応します。

### 5.1. ローカル完結モード (`start.sh`)

ローカル Mac 内で `Ollama`、`whisper-server`、`server.ts` を同時にバックグラウンド起動します。

```bash
# 実行権限の付与
chmod +x start.sh

# 起動
./start.sh

```

* **終了方法**: `Ctrl + C` を押下すると、`trap` ハンドラにより起動された全プロセスが安全に停止します。

### 5.2. リモート GPU モード (`start-remote.sh`)

推論（Whisper / Ollama）を別ホストで常駐させ、ローカルでは中継サーバーのみを動かす構成です。

#### 1. 設定ファイル (`remote.env`)

```bash
# 外部 GPU サーバーの接続設定
GPU_SERVER_HOST="192.168.1.100"

WHISPER_API_URL="http://${GPU_SERVER_HOST}:8080/inference"
OLLAMA_API_URL="http://${GPU_SERVER_HOST}:11434/api/generate"
TRANSLATION_MODEL="qwen2.5:0.5b"
WSS_PORT=3000

```

#### 2. 起動

```bash
# 外部ホストの疎通確認 (HTTP 8080, 11434) を実施した上で Node.js サーバーを起動
./start-remote.sh

```

---

## 6. データフロー図

```text
[Browser Tab: Audio]
       │ (16kHz PCM Stream / WebSocket)
       ▼
[server.ts: Buffer Accumulator]
       │
       │ (3秒毎の WAV Buffer / HTTP POST)
       ▼
[whisper.cpp: /inference]
       │
       │ 認識結果テキスト (例: "Today we are discussing...")
       ▼
[server.ts: Sentence Boundary Buffer]
       │
       ├─ 文末未達 ([.?!] なし) ──→ 次のチャンクを待機
       │
       └─ 文末到達 ("...system architecture.")
              │
              │ (Prompt 埋め込み / HTTP POST)
              ▼
       [Ollama: /api/generate]
              │
              │ 翻訳テキスト ("本日はシステム構造について議論します。")
              ▼
[server.ts: JSON Packager]
       │
       │ { en: "...", ja: "..." } (WebSocket)
       ▼
[Panel Window: DOM Renderer]
       └─ 日本語訳（大）/ 英語原文（小）をカード追加描画

```
