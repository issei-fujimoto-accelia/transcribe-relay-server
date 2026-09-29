let panelWindowId = null;

chrome.action.onClicked.addListener(async () => {
  // すでにウィンドウが開かれているかチェック
  if (panelWindowId !== null) {
    try {
      const win = await chrome.windows.get(panelWindowId);
      if (win) {
        await chrome.windows.update(panelWindowId, { focused: true });
        return;
      }
    } catch (_) {
      // 存在しない場合は新規作成へフォールスルー
      panelWindowId = null;
    }
  }

  // ポップアップなしで独立ウィンドウとして直接作成
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('panel.html'),
    type: 'popup',
    width: 440,
    height: 560
  });

  panelWindowId = win.id;
});

// ウィンドウが閉じられたらIDをクリア
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) {
    panelWindowId = null;
  }
});
