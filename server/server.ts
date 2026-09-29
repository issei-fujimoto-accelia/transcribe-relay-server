import { WebSocketServer, WebSocket } from 'ws';

// 環境変数から取得（未設定時はローカルデフォルト）
const WSS_PORT = Number(process.env.WSS_PORT) || 3000;
const WHISPER_API_URL = process.env.WHISPER_API_URL || 'http://localhost:8080/inference';
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || 'qwen2.5:0.5b';

console.log(`[Config] Whisper URL : ${WHISPER_API_URL}`);
console.log(`[Config] Ollama URL  : ${OLLAMA_API_URL}`);
console.log(`[Config] Model       : ${TRANSLATION_MODEL}`);

// WAVヘッダー付与
function createWavBuffer(pcmData: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcmData.length;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcmData]);
}

// Ollama による英日翻訳
async function translateEnToJa(text: string): Promise<string> {
  const prompt = `Translate the following English speech subtitle into natural Japanese. Output ONLY the Japanese translation without quotes, notes, or explanations.\n\nEnglish: ${text}\nJapanese:`;

  try {
    const res = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1, // 翻訳のブレ・余計な出力を抑制
          num_predict: 128
        }
      })
    });

    if (!res.ok) {
      console.error(`Ollama error HTTP ${res.status}`);
      return '';
    }

    const data = await res.json() as { response: string };
    return data.response.trim();
  } catch (err) {
    console.error('Translation network error:', err);
    return '';
  }
}

const wss = new WebSocketServer({ port: WSS_PORT });
console.log(`WebSocket server listening on ws://localhost:${WSS_PORT}`);

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected from panel');

  let audioChunks: Buffer[] = [];
  const CHUNK_THRESHOLD_BYTES = 16000 * 2 * 3; // 約3秒分

  // テキスト文バッファ
  let textBuffer = '';

  ws.on('message', async (data: Buffer) => {
    audioChunks.push(data);
    const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);

    if (totalLength < CHUNK_THRESHOLD_BYTES) return;

    const pcmBuffer = Buffer.concat(audioChunks);
    audioChunks = [];

    const wavBuffer = createWavBuffer(pcmBuffer, 16000);

    try {
      const formData = new FormData();
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      formData.append('file', blob, 'audio.wav');
      formData.append('temperature', '0.0');

      const res = await fetch(WHISPER_API_URL, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return;

      const result = await res.json() as { text: string };
      const rawText = result.text.trim();

      // 無音トークンや空文字は破棄
      if (!rawText || rawText === '[BLANK_AUDIO]') return;

      // 既存バッファに追記
      textBuffer = textBuffer ? `${textBuffer} ${rawText}` : rawText;

      // 文末記号判定（ピリオド・疑問符・感嘆符）または単語数が多くなりすぎた場合のセーフティ
      const hasSentenceEnd = /[.?!]$/.test(textBuffer.trim());
      const isTooLong = textBuffer.split(' ').length > 20;

      if (hasSentenceEnd || isTooLong) {
        const sentenceToTranslate = textBuffer.trim();
        textBuffer = ''; // バッファをリセット

        console.log(`[EN Input]: ${sentenceToTranslate}`);

        // 翻訳実行
        const translatedJa = await translateEnToJa(sentenceToTranslate);
        console.log(`[JA Trans]: ${translatedJa}`);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            en: sentenceToTranslate,
            ja: translatedJa
          }));
        }
      }
    } catch (err) {
      console.error('Processing error:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});
