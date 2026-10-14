/* Local caption DOM adapters. No access to accounts or private player APIs. */
(() => {
  'use strict';
  const normalize = text => String(text || '').replace(/\s+/gu, ' ').trim();
  const joinTokens = tokens => normalize(tokens.join(' '))
    .replace(/\s+([,.;:!?，。！？、；：%…\)\]”])/gu, '$1')
    .replace(/([\(\[“])\s+/gu, '$1')
    .replace(/\s+(['’](?:s|t|re|ve|d|m|ll)\b)/giu, '$1')
    .replace(/\s+(n['’]t)\b/giu, '$1')
    .replace(/(['’])\s+(s|t|re|ve|d|m|ll)\b/giu, '$1$2')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '$1');

  function visible(element) {
    if (!element?.isConnected) return false;
    const view = element.ownerDocument.defaultView;
    for (let el = element; el; el = el.parentElement || el.getRootNode()?.host) {
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    // Does not use document.hidden: captions must still be read when minimized.
    return element.getClientRects().length > 0;
  }

  function textOf(element) {
    if (!visible(element)) return '';
    // Trancy renders words as adjacent .token spans, separated visually by CSS.
    const tokens = [...element.querySelectorAll('.token')]
      .filter(el => !el.parentElement?.closest('.token') && visible(el));
    if (tokens.length) {
      return joinTokens(tokens.map(el => normalize(el.textContent))).slice(0, 12000);
    }
    return normalize(element.textContent).slice(0, 12000);
  }

  function rootsOf(doc) {
    const roots = [doc];
    // Trancy 7.9.4 uses light DOM. Support open shadow roots under its hosts too.
    for (const host of doc.querySelectorAll('trancy-caption-window, trancy-app')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
      for (const child of host.querySelectorAll('*')) if (child.shadowRoot) roots.push(child.shadowRoot);
    }
    return roots;
  }

  function read(doc) {
    const roots = rootsOf(doc);
    let trancyActive = false;
    for (const root of roots) {
      for (const box of root.querySelectorAll('.trancy-caption-content')) {
        if (!visible(box)) continue;
        trancyActive = true;
        const original = textOf(box.querySelector('.trancy-caption-primary'));
        const translatedElement = box.querySelector('.trancy-caption-secondary');
        const translation = translatedElement?.matches('.ai-loading, .error') ? '' : textOf(translatedElement);
        if (original || translation) return { original, translation, source: 'Trancy 双语字幕', found: true, trancyActive: true };
      }
      // Learning/reading mode contains many sentences: read only the active one.
      for (const row of root.querySelectorAll('.trancy-subtitle-wrapper.active')) {
        if (!visible(row)) continue;
        trancyActive = true;
        const original = textOf(row.querySelector('.trancy-primary-subtitle'));
        const translation = textOf(row.querySelector('.trancy-secondary-subtitle'));
        if (original || translation) return { original, translation, source: 'Trancy 学习模式', found: true, trancyActive: true };
      }
      trancyActive ||= [...root.querySelectorAll('.trancy-subtitle-container')].some(visible);
    }
    // A visible but temporarily empty Trancy box still owns the subtitles.
    // Hidden/leftover hosts alone must not block the native fallback.
    if (trancyActive) return { original: '', translation: '', source: 'Trancy 双语字幕', found: true, trancyActive: true };
    return readYouTube(doc);
  }

  function readYouTube(doc) {
    const player = doc.querySelector('#movie_player');
    const cc = player?.querySelector('.ytp-subtitles-button');
    const enabled = cc?.getAttribute('aria-pressed');
    const lines = [];
    // Respect CC being switched off, even if YouTube retains stale caption DOM.
    if (enabled !== 'false') {
      for (const box of player?.querySelectorAll('.ytp-caption-window-container .captions-text') || []) {
        if (!visible(box)) continue;
        const visualLines = box.querySelectorAll('.caption-visual-line');
        const candidates = visualLines.length ? visualLines : [box];
        for (const line of candidates) {
          if (!visible(line)) continue;
          // Keep native whitespace: segments can be partial words, not tokens.
          const segments = [...line.querySelectorAll('.ytp-caption-segment')].filter(visible);
          const text = normalize(segments.length ? segments.map(el => el.textContent).join('') : line.textContent);
          if (text) lines.push(text);
        }
      }
    }
    return { original: lines.join('\n').slice(0, 12000), translation: '', source: 'YouTube 原生字幕', found: enabled === 'true' || lines.length > 0, trancyActive: false };
  }
  globalThis.TrancyFloatReader = Object.freeze({ read, rootsOf, joinTokens });
})();
