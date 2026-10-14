(() => {
  'use strict';
  if (globalThis.__trancyFloatLoaded) return;
  globalThis.__trancyFloatLoaded = true;

  const reader = globalThis.TrancyFloatReader;
  const sizeKeys = ['originalSize', 'translationSize'];
  const defaults = { originalSize: 30, translationSize: 24, subtitleGap: 12, windowWidth: 1000, compactMode: false };
  let settings = { ...defaults };
  let pip = null, ui = null, opening = false, video = null;
  let observer = null, heartbeat = null;
  let nativeCaptionsRequested = false;
  let launcher = null, launcherRoot = null, toastTimer = null;
  let pageKey = location.href, storedError = false;
  const observedTargets = new Set();
  const clamp = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(14, Math.min(72, Math.round(Number(value)))) : fallback;
  const bounded = (value, fallback, min, max) => value !== null && value !== '' && Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;

  const settingsReady = chrome.storage.local.get(defaults).then(saved => {
    settings.originalSize = clamp(saved.originalSize, defaults.originalSize);
    settings.translationSize = clamp(saved.translationSize, defaults.translationSize);
    settings.subtitleGap = bounded(saved.subtitleGap, defaults.subtitleGap, 0, 80);
    settings.windowWidth = bounded(saved.windowWidth, defaults.windowWidth, 240, 1920);
    settings.compactMode = saved.compactMode === true;
    applySize();
    applyCompactMode();
  }).catch(() => { storedError = true; });

  function element(doc, tag, attrs = {}, text = '') {
    const el = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text) el.textContent = text;
    return el;
  }
  function button(doc, label, title, action) {
    const el = element(doc, 'button', { type: 'button', title, 'aria-label': title }, label);
    el.addEventListener('click', action);
    return el;
  }
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

  const css = `
    :root {color-scheme:dark; --original-size:30px; --translation-size:24px; --subtitle-gap:12px}
    * {box-sizing:border-box}
    body {margin:0;background:#10141d;color:#f4f7fb;font-family:"Segoe UI","Microsoft YaHei",sans-serif;height:100vh;display:flex;flex-direction:column;position:relative}
    .tf-controls {position:absolute;z-index:2;transition:opacity .15s ease}
    header {bottom:8px;right:24px;display:flex;align-items:center;gap:8px}
    #tf-mode {top:6px;left:8px}
    button {border:1px solid #3b475b;border-radius:8px;background:#202938;color:#ecf3fe;padding:7px 11px;font:inherit;font-size:13px;cursor:pointer}
    button:hover {background:#30425a} button:focus-visible,input:focus-visible,summary:focus-visible {outline:2px solid #75ddcb;outline-offset:2px}
    button:disabled {opacity:.45;cursor:default}
    #tf-play {min-width:80px;background:#77dcc6;color:#102722;border-color:#77dcc6;font-weight:700}
    #tf-time {font-size:12px;color:#aab8cc;font-variant-numeric:tabular-nums;white-space:nowrap}
    main {flex:1;min-height:0;overflow:auto;padding:10px 24px;display:flex;flex-direction:column;justify-content:safe center;gap:var(--subtitle-gap);text-align:center}
    #tf-original {font-size:var(--original-size);line-height:1.45;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
    #tf-translation {font-size:var(--translation-size);line-height:1.5;color:#8fe1cc;white-space:pre-wrap;overflow-wrap:anywhere}
    #tf-empty {font-size:15px;color:#9cabbe;line-height:1.65}
    [hidden] {display:none!important}
    footer {bottom:5px;left:8px;padding:5px 8px 0;font-size:11px;color:#9aabc1;border-top:1px solid #293143}
    #tf-status {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    details {font-size:12px;min-width:108px} summary {cursor:pointer;user-select:none}
    .sizes {position:absolute;left:0;bottom:30px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px 12px;padding:12px;min-width:260px;max-height:calc(100vh - 40px);overflow:auto;background:#17202e;border:1px solid #3b475b;border-radius:8px}
    input {accent-color:#77dcc6;min-width:80px;width:100%}
    output {min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
    #tf-windowWidth {background:#10141d;color:#f4f7fb;border:1px solid #3b475b;border-radius:4px;padding:4px}
    #tf-width-status {grid-column:1/-1;max-width:300px;line-height:1.5}
    #tf-compact[aria-pressed="true"] {color:#9af0d9;border-color:#77dcc6;background:#173d36}
    body.compact:not(:hover):not(.keyboard-controls) .tf-controls {opacity:0;visibility:hidden;pointer-events:none}
    @media(prefers-reduced-motion:reduce) {.tf-controls {transition:none}}
    @media(max-width:700px) {main{padding:44px 16px 80px}header{right:16px;bottom:8px;gap:5px}footer{bottom:48px}button{padding:6px 8px}#tf-play{min-width:62px}}
  `;

  function buildWindow(win) {
    const doc = win.document;
    doc.title = 'Trancy 字幕浮窗';
    doc.documentElement.lang = 'zh-CN';
    const style = element(doc, 'style');
    style.textContent = css;
    doc.head.append(style);
    doc.body.replaceChildren();
    const header = element(doc, 'header', { class: 'tf-controls' });
    const rewind = button(doc, '−5 秒', '后退 5 秒', () => seek(-5));
    const play = button(doc, '播放', '播放 / 暂停', togglePlayback); play.id = 'tf-play';
    const forward = button(doc, '+5 秒', '前进 5 秒', () => seek(5));
    const time = element(doc, 'span', { id: 'tf-time' }, '00:00');
    const smaller = button(doc, 'A−', '减小两行字幕字号', () => changeBoth(-2));
    const larger = button(doc, 'A+', '增大两行字幕字号', () => changeBoth(2));
    const compact = button(doc, '精简模式', '开启精简模式：移开鼠标隐藏控制栏', () => {
      settings.compactMode = !settings.compactMode;
      applyCompactMode(); saveSettings();
    });
    compact.id = 'tf-compact';
    header.append(rewind, play, forward, time, smaller, larger);
    const modeControl = element(doc, 'div', { id: 'tf-mode', class: 'tf-controls' });
    modeControl.append(compact);

    const main = element(doc, 'main');
    const original = element(doc, 'div', { id: 'tf-original', dir: 'auto' });
    const translation = element(doc, 'div', { id: 'tf-translation', dir: 'auto' });
    const empty = element(doc, 'div', { id: 'tf-empty' }, '等待 Trancy 字幕…');
    main.append(original, translation, empty);
    const footer = element(doc, 'footer', { class: 'tf-controls' });
    const status = element(doc, 'span', { id: 'tf-status', role: 'status' }, '正在连接视频');
    const details = element(doc, 'details');
    details.append(element(doc, 'summary', {}, '字幕与宽度设置'));
    const sizes = element(doc, 'div', { class: 'sizes' });
    const inputs = {}, outputs = {};
    for (const [key, label, min, max] of [['originalSize', '原文字号', 14, 72], ['translationSize', '译文字号', 14, 72], ['subtitleGap', '双语间距', 0, 80]]) {
      const id = `tf-${key}`;
      const input = element(doc, 'input', { id, type: 'range', min: String(min), max: String(max), step: '1', 'aria-label': label });
      const output = element(doc, 'output', { for: id });
      input.addEventListener('input', () => { settings[key] = Number(input.value); applySize(); });
      input.addEventListener('change', saveSettings);
      sizes.append(element(doc, 'label', { for: id }, label), input, output);
      inputs[key] = input; outputs[key] = output;
    }
    const widthInput = element(doc, 'input', { id: 'tf-windowWidth', type: 'number', min: '240', max: '1920', step: '1', 'aria-label': '目标窗口宽度（px）' });
    widthInput.value = String(settings.windowWidth);
    const applyWidth = button(doc, '应用', '应用窗口宽度', () => {
      settings.windowWidth = bounded(widthInput.value, defaults.windowWidth, 240, 1920);
      widthInput.value = String(settings.windowWidth);
      saveSettings();
      try {
        // resizeTo uses the outer window size. Chrome still enforces its own cap.
        win.resizeTo(settings.windowWidth, win.outerHeight);
        win.setTimeout(() => updateWidthStatus(win), 250);
      } catch {
        setText(widthStatus, 'Chrome 未允许调整宽度；请尝试拖动窗口边缘。');
      }
    });
    widthInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); applyWidth.click(); }
    });
    const widthStatus = element(doc, 'span', { id: 'tf-width-status', role: 'status' });
    sizes.append(element(doc, 'label', { for: 'tf-windowWidth' }, '窗口宽度'), widthInput, applyWidth, widthStatus);
    details.append(sizes);
    footer.append(details);
    doc.body.append(main, modeControl, footer, header, status);
    ui = { original, translation, empty, status, time, play, rewind, forward, inputs, outputs, compact, widthStatus };
    win.addEventListener('resize', () => updateWidthStatus(win));
    updateWidthStatus(win);
    doc.addEventListener('keydown', event => {
      // Reveal controls before the browser moves keyboard focus with Tab.
      if (event.key === 'Tab') doc.body.classList.add('keyboard-controls');
      const tag = event.target?.tagName;
      if (['INPUT', 'BUTTON', 'SUMMARY', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    });
    doc.addEventListener('pointerdown', () => doc.body.classList.remove('keyboard-controls'));
    doc.addEventListener('focusout', () => queueMicrotask(() => {
      if (!doc.activeElement?.closest('.tf-controls')) doc.body.classList.remove('keyboard-controls');
    }));
    win.addEventListener('blur', () => doc.body.classList.remove('keyboard-controls'));
    applySize();
    applyCompactMode();
  }

  function applyCompactMode() {
    if (!pip || pip.closed || !ui) return;
    pip.document.body.classList.toggle('compact', settings.compactMode);
    ui.compact.setAttribute('aria-pressed', String(settings.compactMode));
    const label = settings.compactMode ? '退出精简' : '精简模式';
    const title = settings.compactMode ? '退出精简模式：始终显示控制栏' : '开启精简模式：移开鼠标隐藏控制栏';
    setText(ui.compact, label);
    ui.compact.title = title;
    ui.compact.setAttribute('aria-label', title);
  }

  function applySize() {
    if (!pip || pip.closed || !ui) return;
    pip.document.documentElement.style.setProperty('--original-size', `${settings.originalSize}px`);
    pip.document.documentElement.style.setProperty('--translation-size', `${settings.translationSize}px`);
    pip.document.documentElement.style.setProperty('--subtitle-gap', `${settings.subtitleGap}px`);
    for (const key of [...sizeKeys, 'subtitleGap']) {
      ui.inputs[key].value = String(settings[key]);
      setText(ui.outputs[key], `${settings[key]} px`);
    }
  }
  function updateWidthStatus(win) {
    if (!ui || win.closed || win !== pip) return;
    const actual = Math.round(win.outerWidth);
    const limited = actual < settings.windowWidth - 2;
    setText(ui.widthStatus, `实际宽度 ${actual} px${limited ? `，目标 ${settings.windowWidth} px 未达到。` : '。'}Chrome 上限约为屏幕宽度的 80%，填写 1920 无法绕过此限制。`);
  }
  function saveSettings() {
    chrome.storage.local.set(settings).catch(() => {
      storedError = true;
      if (ui) setText(ui.status, '设置未保存；扩展更新后请刷新 YouTube');
    });
  }
  function changeBoth(delta) {
    for (const key of sizeKeys) settings[key] = clamp(settings[key] + delta, defaults[key]);
    applySize(); saveSettings();
  }

  function pickVideo() {
    return document.querySelector('#movie_player video.html5-main-video')
      || document.querySelector('#movie_player video')
      || document.querySelector('video.html5-main-video');
  }
  function bindVideo() {
    const next = pickVideo();
    if (video === next) return;
    if (video) for (const name of ['timeupdate', 'play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'emptied']) video.removeEventListener(name, sync);
    video = next;
    if (video) for (const name of ['timeupdate', 'play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'emptied']) video.addEventListener(name, sync);
  }
  async function togglePlayback() {
    bindVideo();
    if (!video) return;
    try { if (video.paused) await video.play(); else video.pause(); }
    catch { if (ui) setText(ui.status, '无法播放，请先在 YouTube 页面点一次播放'); }
    sync();
  }
  function seek(delta) {
    bindVideo();
    if (!video) return;
    try {
      let target = Math.max(0, video.currentTime + delta);
      if (Number.isFinite(video.duration)) target = Math.min(video.duration, target);
      if (video.seekable.length) {
        const start = video.seekable.start(0), end = video.seekable.end(video.seekable.length - 1);
        if (end > start) target = Math.max(start, Math.min(end, target));
      }
      video.currentTime = target;
    } catch { /* Media not yet ready. */ }
    sync();
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60), secs = String(total % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${secs}` : `${String(minutes).padStart(2, '0')}:${secs}`;
  }

  function sync() {
    if (!pip || pip.closed || !ui) return;
    bindVideo();
    const ad = !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
    const result = ad ? { original: '', translation: '', found: true } : reader.read(document);
    if (!ad) {
      if (result.trancyActive) nativeCaptionsRequested = false;
      else if (!nativeCaptionsRequested) {
        const cc = document.querySelector('#movie_player .ytp-subtitles-button');
        if (cc && !cc.disabled && cc.getAttribute('aria-disabled') !== 'true') {
          // Try once when entering native mode. Do not fight manual CC changes.
          nativeCaptionsRequested = true;
          if (cc.getAttribute('aria-pressed') === 'false') cc.click();
        }
      }
    }
    // Clear disappeared captions immediately; never leave an old line on screen.
    setText(ui.original, result.original);
    setText(ui.translation, result.translation);
    ui.original.hidden = !result.original;
    ui.translation.hidden = !result.translation;
    ui.empty.hidden = !!(result.original || result.translation);
    setText(ui.empty, ad ? '广告播放中，等待正片…' : result.found ? '当前没有字幕，等待下一句…' : '请开启 YouTube 字幕（CC）或 Trancy 双语字幕。\n视频需要有可用字幕。');
    setText(ui.play, video && !video.paused && !video.ended ? '暂停' : '播放');
    for (const control of [ui.play, ui.rewind, ui.forward]) control.disabled = !video;
    setText(ui.time, formatTime(video?.currentTime));
    setText(ui.status, storedError ? '设置仅本次有效；请刷新页面后重试' : !video ? '未找到 YouTube 视频' : ad ? '广告中' : result.source ? `${result.source} · ${video.paused ? '已暂停' : '同步中'}` : '等待字幕');
  }

  function observeCaptions() {
    if (!observer) return;
    const targets = new Set();
    for (const root of reader.rootsOf(document)) {
      for (const target of root.querySelectorAll('trancy-caption-window, trancy-app, .trancy-subtitle-container, #movie_player .ytp-caption-window-container, #movie_player .ytp-subtitles-button')) targets.add(target);
      if (root !== document) targets.add(root);
    }
    // Reconnect when React replaces a host; discard detached observer targets.
    if ([...observedTargets].some(target => !target.isConnected)) {
      observer.disconnect(); observedTargets.clear();
    }
    for (const target of targets) if (!observedTargets.has(target)) {
      observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-pressed'] });
      observedTargets.add(target);
    }
  }
  function stopSync() {
    if (heartbeat !== null) { try { pip?.clearInterval(heartbeat); } catch {} }
    heartbeat = null;
    observer?.disconnect(); observer = null; observedTargets.clear();
    if (video) for (const name of ['timeupdate', 'play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'emptied']) video.removeEventListener(name, sync);
    video = null; ui = null; pip = null;
    nativeCaptionsRequested = false;
    if (launcherRoot) setText(launcherRoot.querySelector('button'), '字幕浮窗');
  }
  async function openPip() {
    if (pip && !pip.closed) { pip.focus(); return true; }
    if (opening) return false;
    if (!window.documentPictureInPicture) { showToast('需要桌面版 Chrome 116 或以上版本'); return false; }
    opening = true;
    try {
      await settingsReady;
      pip = await window.documentPictureInPicture.requestWindow({ width: settings.windowWidth, height: 160 });
      buildWindow(pip);
      pip.addEventListener('pagehide', stopSync, { once: true });
      observer = new MutationObserver(sync);
      observeCaptions(); bindVideo(); sync();
      // Timer belongs to the visible PiP window, not the minimized source tab.
      heartbeat = pip.setInterval(() => { observeCaptions(); sync(); }, 250);
      setText(launcherRoot?.querySelector('button'), '字幕浮窗已打开');
      return true;
    } catch (error) {
      if (pip && !pip.closed) pip.close();
      stopSync();
      showToast(error.name === 'NotAllowedError' ? '请点击页面左下角「字幕浮窗」打开' : `浮窗打开失败：${error.message}`);
      return false;
    } finally { opening = false; }
  }

  function showToast(message) {
    ensureLauncher();
    const note = launcherRoot?.querySelector('.note');
    if (!note) return;
    note.textContent = message; note.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { note.hidden = true; }, 7000);
  }
  function ensureLauncher() {
    const eligible = /^\/(watch|live\/|shorts\/)/u.test(location.pathname);
    if (!eligible) { if (launcher) launcher.style.setProperty('display', 'none', 'important'); return; }
    if (launcher?.isConnected) { launcher.style.setProperty('display', 'block', 'important'); return; }
    launcher = element(document, 'div', { id: 'trancy-float-launcher' });
    launcher.style.cssText = 'position:fixed!important;left:18px!important;bottom:20px!important;z-index:2147483647!important;display:block!important;';
    launcherRoot = launcher.attachShadow({ mode: 'open' });
    const style = element(document, 'style');
    style.textContent = ':host{font-family:"Microsoft YaHei",sans-serif}button{font:600 13px "Microsoft YaHei",sans-serif;cursor:pointer;color:#d9fff4;background:#173d36;border:1px solid #63b9a6;border-radius:22px;padding:10px 16px;box-shadow:0 4px 18px #0005}button:hover{background:#245448}button:focus-visible{outline:3px solid #a0ffe2}.note{background:#15202e;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:8px;max-width:340px;font-size:13px;line-height:1.6}';
    const note = element(document, 'div', { class: 'note', role: 'status' }); note.hidden = true;
    launcherRoot.append(style, note, button(document, '字幕浮窗', '打开 Trancy 字幕浮窗（Alt+Shift+S）', openPip));
    document.documentElement.append(launcher);
  }
  function onNavigate() {
    if (pageKey !== location.href) {
      pageKey = location.href;
      if (pip && !pip.closed) pip.close();
    }
    ensureLauncher();
  }
  document.addEventListener('yt-navigate-start', () => { if (pip && !pip.closed) pip.close(); });
  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyS' && !event.repeat) {
      event.preventDefault(); openPip();
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'TRANCY_FLOAT_OPEN') return false;
    ensureLauncher();
    openPip().then(opened => respond({ opened }));
    return true;
  });
  ensureLauncher();
})();
