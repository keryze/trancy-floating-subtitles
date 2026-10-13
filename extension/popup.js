'use strict';
document.getElementById('open').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    // Tab IDs are available without the broad tabs permission; no URL/history read.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No tab');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'TRANCY_FLOAT_OPEN' });
    if (result?.opened) window.close();
    else status.textContent = '请关闭此面板，点击页面左下角「字幕浮窗」。Chrome 要求在页面内点击后打开。';
  } catch {
    status.textContent = '请打开 YouTube 视频页并刷新一次，再开启 Trancy 双语字幕。';
  }
});
