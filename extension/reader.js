/* Local DOM adapter for Trancy 7.9.4. No access to Trancy accounts or internals. */
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
    let found = false;
    for (const root of roots) {
      for (const box of root.querySelectorAll('.trancy-caption-content')) {
        found = true;
        if (!visible(box)) continue;
        const original = textOf(box.querySelector('.trancy-caption-primary'));
        const translatedElement = box.querySelector('.trancy-caption-secondary');
        const translation = translatedElement?.matches('.ai-loading, .error') ? '' : textOf(translatedElement);
        if (original || translation) return { original, translation, source: 'Trancy 双语字幕', found: true };
      }
      // Learning/reading mode contains many sentences: read only the active one.
      for (const row of root.querySelectorAll('.trancy-subtitle-wrapper.active')) {
        found = true;
        if (!visible(row)) continue;
        const original = textOf(row.querySelector('.trancy-primary-subtitle'));
        const translation = textOf(row.querySelector('.trancy-secondary-subtitle'));
        if (original || translation) return { original, translation, source: 'Trancy 学习模式', found: true };
      }
      found ||= !!root.querySelector('trancy-caption-window, trancy-app, .trancy-subtitle-container');
    }
    return { original: '', translation: '', source: '', found };
  }
  globalThis.TrancyFloatReader = Object.freeze({ read, rootsOf, joinTokens });
})();
