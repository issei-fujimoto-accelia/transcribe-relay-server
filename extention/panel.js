let isCapturing = false;
let socket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let lastCaptionText = '';

const toggleBtn = document.getElementById('toggleBtn');
const clearBtn = document.getElementById('clearBtn');
const captionsDiv = document.getElementById('captions');
const emptyHint = document.getElementById('emptyHint');
const syslogDiv = document.getElementById('syslog');

// システムログ出力
function logStatus(text, type = 'info') {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  if (type === 'error') line.className = 'err-log';
  if (type === 'success') line.className = 'suc-log';
  syslogDiv.appendChild(line);
  syslogDiv.scrollTop = syslogDiv.scrollHeight;
}

// 字幕を追加表示
function addCaption(enText, jaText) {
    if (emptyHint) emptyHint.remove();

    const item = document.createElement('div');
    item.className = 'caption-item';

    const jaDiv = document.createElement('div');
    jaDiv.className = 'caption-ja';
    jaDiv.textContent = jaText || '(翻訳中 / 取得失敗)';

    const enDiv = document.createElement('div');
    enDiv.className = 'caption-en';
    enDiv.textContent = enText;

    item.appendChild(jaDiv);
    item.appendChild(enDiv);
    captionsDiv.appendChild(item);

    // 常に最新の発話へスクロール
    captionsDiv.scrollTop = captionsDiv.scrollHeight;
}

clearBtn.addEventListener('click', () => {
  captionsDiv.innerHTML = '';
});

toggleBtn.addEventListener('click', async () => {
  if (!isCapturing) {
    await startCapture();
  } else {
    stopCapture('ユーザーによる手動停止');
  }
});

async function startCapture() {
  logStatus('WebSocket (ws://localhost:3000) へ接続中...');

  try {
    socket = new WebSocket('ws://localhost:3000');
  } catch (e) {
    logStatus(`WS接続初期化エラー: ${e.message}`, 'error');
    return;
  }

  socket.onopen = () => {
    logStatus('WS接続完了', 'success');
  };

  socket.onmessage = (event) => {
      try {
          const data = JSON.parse(event.data);
          if (data.en) {
              addCaption(data.en, data.ja);
          }
    } catch (_) {
      if (typeof event.data === 'string' && event.data.trim()) {
        addCaption(event.data.trim());
      }
    }
  };

  socket.onerror = () => {
    logStatus('WS通信エラー (Node.js サーバーの状態を確認してください)', 'error');
  };

  socket.onclose = () => {
    logStatus('WS接続が切断されました', 'info');
    if (isCapturing) stopCapture('WS切断');
  };

  try {
    logStatus('共有ダイアログをオープン');

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { suppressLocalAudioPlayback: false },
      systemAudio: 'include'
    });

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      mediaStream.getTracks().forEach(t => t.stop());
      throw new Error('音声が共有されていません。「タブの音声を共有」をONにしてください。');
    }

    // 映像トラックは即座に破棄
    mediaStream.getVideoTracks().forEach(t => t.stop());

    audioTracks[0].onended = () => {
      stopCapture('共有停止');
    };

    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL('pcm-processor.js'));

    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

      // source.connect(audioContext.destination);
    source.connect(workletNode);

    workletNode.port.onmessage = (e) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(e.data);
      }
    };

    isCapturing = true;
    toggleBtn.textContent = 'キャプチャ停止';
    toggleBtn.classList.add('stop');
    logStatus('パイプライン稼働中', 'success');

  } catch (err) {
    logStatus(`開始失敗: ${err.message}`, 'error');
    stopCapture();
  }
}

function stopCapture(reason = '') {
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }

  isCapturing = false;
  toggleBtn.textContent = '共有対象を選択して開始';
  toggleBtn.classList.remove('stop');
  if (reason) logStatus(reason);
}
