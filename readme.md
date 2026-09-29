# README

## setup
### whisper.cppのクローンとビルド

``` shell
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```


#### 英語モデル（base.en）のダウンロード
``` shell
bash ./models/download-ggml-model.sh base.en
```


#### HTTPサーバーモードで起動 (ポート8080)
後からサーバーはまとめて起動するのでここで起動する必要はない

``` shell
script_dir="/Users/ac297/mysrc/whisper.cpp"
${script_dir}/build/bin/whisper-server -m models/ggml-base.en.bin --port 8080 --language en
```

### ollama

``` shell
brew install ollama

ollama pull qwen3.5:0.8b
ollama pull qwen3.5:0.8b-mlx // macのユニファイドメモリ使える人

// ollama run qwen2.5:1.5b // 後からサーバーはまとめて起動するのでここで起動する必要はない
// ollama run qwen2.5:0.5b // 後からサーバーはまとめて起動するのでここで起動する必要はない
```


### Typescript サーバーの起動
installだけ、後からサーバーはまとめて起動するのでここで起動する必要はない

```shell
npm install
// npm start
```

### Chrome拡張機能の読み込み
Chromeで chrome://extensions/ を開く。
「デベロッパーモード」をONにし、「パッケージ化されていない拡張機能を読み込む」からextentionフォルダを選択。


## RUN
### サーバーの起動
``` shell
sh start.sh
```

`local_mac.env`が読み込まれるので、モデルなどを変更したい場合はここを修正


### 文字起こしの開始
ブラウザで英語音声が流れるタブ（YouTube等）を開く。
拡張機能のアイコンをクリックし、「Start Capture」を押す。
ターミナルおよび拡張機能のポップアップ内に文字起こし結果が逐次出力されます。


## remote
GPUサーバー側でollamaとwhiperを動かすパターン

### GPUサーバー側で以下を設定

``` shell
bash ./models/download-ggml-model.sh medium.en
./whisper-server --host 0.0.0.0 --port 8080 ...
```

``` shell
ollama pull qwen3.5:2b
ollama pull qwen3.5:4b

OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

### ローカル側では以下を起動

``` shell
sh start-remote.sh
```

`remote.env`が読み込まれるので、モデルなどを変更したい場合はここを修正
