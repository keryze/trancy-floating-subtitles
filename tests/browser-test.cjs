/* Tests use a fresh headless browser and synthetic Trancy markup, never the user's profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const reports = [];
const record = name => { reports.push(name); console.log('PASS', name); };
const wav = Buffer.alloc(44 + 8000 * 90);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40); wav.fill(128, 44);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body{background:#e5eaf2;font:20px sans-serif}#movie_player{width:900px;height:520px;background:#182335;color:white;padding:20px}
video{width:200px;height:100px}.trancy-caption-content{padding:20px}.token{margin-right:4px}.trancy-caption-secondary{margin-top:12px}
</style></head><body><h1>Trancy 7.9.4 adapter test fixture</h1><div id="movie_player"><video muted class="html5-main-video" src="/sample.wav" preload="auto"></video>
<trancy-caption-window id="trancy-caption-window"><div class="trancy-caption-content"><div class="trancy-caption-primary"><span class="token">Let's</span><span class="token">learn</span><span class="token">English</span><span class="token">together.</span></div><div class="trancy-caption-secondary">我们一起学英语。</div></div></trancy-caption-window></div>
<script src="/reader.js"></script><script src="/content.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/sample.wav') {
    res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes');
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`);
      res.setHeader('Content-Length', end - start + 1); return res.end(wav.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', wav.length); return res.end(wav);
  }
  if (['/reader.js', '/content.js'].includes(req.url)) { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(root, 'extension', req.url.slice(1)))); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.testStorage = {};
      window.chrome = { storage: { local: {
        get: async defaults => ({ ...defaults, ...window.testStorage }),
        set: async values => Object.assign(window.testStorage, values)
      } }, runtime: { onMessage: { addListener: fn => { window.testMessage = fn; } } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/watch?v=test`);
    const read = () => page.evaluate(() => TrancyFloatReader.read(document));
    assert.equal((await read()).original, "Let's learn English together.");
    assert.equal((await read()).translation, '我们一起学英语。');
    record('Real Trancy 7.9.4 selectors and spaced word tokens');
    assert.equal(await page.evaluate(() => TrancyFloatReader.joinTokens(['I', 'do', "n't", 'know', ',', 'do', 'you', '?'])), "I don't know, do you?");
    assert.equal(await page.evaluate(() => TrancyFloatReader.joinTokens(['你', '好', '世', '界', '。'])), '你好世界。');
    record('Contractions, punctuation and Chinese token spacing');

    await page.locator('#trancy-float-launcher button').click();
    await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('#tf-original'));
    const pipValue = id => page.evaluate(id => documentPictureInPicture.window.document.getElementById(id).textContent, id);
    assert.equal(await pipValue('tf-original'), "Let's learn English together.");
    assert.equal(await pipValue('tf-translation'), '我们一起学英语。');
    record('Native Document Picture-in-Picture opens and mirrors both languages');

    for (const gap of [0, 36, 80]) {
      const actualGap = await page.evaluate(gap => {
        const win = documentPictureInPicture.window, doc = win.document;
        const input = doc.getElementById('tf-subtitleGap');
        input.value = String(gap);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return doc.getElementById('tf-translation').getBoundingClientRect().top
          - doc.getElementById('tf-original').getBoundingClientRect().bottom;
      }, gap);
      assert.ok(Math.abs(actualGap - gap) < 1, `Expected ${gap}px gap, got ${actualGap}`);
      assert.equal(await page.evaluate(() => testStorage.subtitleGap), gap);
    }
    record('Bilingual gap changes real text geometry at 0, 36 and 80px and saves');

    await page.evaluate(() => {
      const doc = documentPictureInPicture.window.document;
      doc.getElementById('tf-windowWidth').value = '1920';
      doc.querySelector('[aria-label="应用窗口宽度"]').click();
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-width-status').textContent.includes('目标 1920'));
    assert.equal(await page.evaluate(() => testStorage.windowWidth), 1920);
    const widthProbe = await page.evaluate(() => ({
      screenWidth: screen.width,
      actualWidth: documentPictureInPicture.window.outerWidth,
      message: documentPictureInPicture.window.document.getElementById('tf-width-status').textContent
    }));
    console.log('Native 1920px width request:', JSON.stringify(widthProbe));
    assert.ok(widthProbe.actualWidth < 1920, 'Small test display should enforce a native limit');
    assert.ok(widthProbe.message.includes(`实际宽度 ${widthProbe.actualWidth} px`));
    record('1920px request saves target and reports native browser-limited actual width');

    await page.evaluate(() => {
      const doc = documentPictureInPicture.window.document;
      const gap = doc.getElementById('tf-subtitleGap');
      gap.value = '12'; gap.dispatchEvent(new Event('input')); gap.dispatchEvent(new Event('change'));
    });

    await page.evaluate(() => { document.querySelector('.trancy-caption-primary').textContent = 'This is the next sentence.'; document.querySelector('.trancy-caption-secondary').textContent = '这是下一句话。'; });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-translation').textContent === '这是下一句话。');
    record('Mutation-driven subtitle changes');

    const backgroundTab = await context.newPage();
    await backgroundTab.goto('about:blank');
    await backgroundTab.bringToFront();
    const sourceHidden = await page.evaluate(() => document.hidden);
    console.log('Source tab hidden during background test:', sourceHidden);
    await page.evaluate(() => { document.querySelector('.trancy-caption-primary').textContent = 'Still updating in the background.'; });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Still updating in the background.', null, { polling: 100 });
    record(sourceHidden ? 'Real background tab keeps subtitle updates' : 'Secondary tab open does not break subtitle updates (headless source remains visible)');
    await backgroundTab.close(); await page.bringToFront();

    await page.evaluate(() => {
      const host = document.querySelector('trancy-caption-window'); const clone = host.cloneNode(true);
      clone.querySelector('.trancy-caption-primary').textContent = 'Host replaced.';
      host.replaceWith(clone);
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Host replaced.');
    record('React caption host replacement is rediscovered');

    await page.evaluate(() => {
      const doc = documentPictureInPicture.window.document;
      doc.querySelector('[aria-label="增大两行字幕字号"]').click();
    });
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.documentElement.style.getPropertyValue('--original-size')), '32px');
    assert.equal(await page.evaluate(() => testStorage.originalSize), 32);
    assert.equal(await page.evaluate(() => testStorage.subtitleGap), 12, 'Font shortcuts must not change spacing');
    await page.evaluate(() => {
      const input = documentPictureInPicture.window.document.getElementById('tf-translationSize');
      input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => testStorage.translationSize), 40);
    record('Independent font sizes and persisted settings');

    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-play').click());
    await page.waitForFunction(() => !document.querySelector('video').paused);
    await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-play').click());
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await page.evaluate(() => documentPictureInPicture.window.document.querySelector('[aria-label="前进 5 秒"]').click());
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 5);
    record('Native video playback/pause and +5 second seek');

    await page.evaluate(() => document.querySelector('.trancy-caption-secondary').classList.add('ai-loading'));
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-translation').hidden);
    record('Loading translations do not display stale text');
    await page.evaluate(() => { document.querySelector('.trancy-caption-content').hidden = true; });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === '');
    record('Hidden/disappeared captions clear immediately');

    await page.evaluate(() => {
      const player = document.querySelector('#movie_player');
      const cc = document.createElement('button');
      cc.className = 'ytp-subtitles-button'; cc.setAttribute('aria-pressed', 'false'); cc.textContent = 'CC';
      const captions = document.createElement('div');
      captions.className = 'ytp-caption-window-container'; captions.hidden = true;
      captions.innerHTML = '<div class="caption-window"><div class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment">Hel</span><span class="ytp-caption-segment">lo world.</span></span><br><span class="caption-visual-line"><span class="ytp-caption-segment">Second line.</span></span></div></div>';
      window.testCCClicks = 0;
      cc.addEventListener('click', () => {
        window.testCCClicks++;
        const on = cc.getAttribute('aria-pressed') !== 'true';
        cc.setAttribute('aria-pressed', String(on));
        document.querySelector('.ytp-caption-window-container').hidden = !on;
      });
      player.append(cc, captions);
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Hello world.\nSecond line.');
    assert.equal(await page.evaluate(() => testCCClicks), 1);
    assert.equal(await pipValue('tf-translation'), '');
    assert.equal((await read()).source, 'YouTube 原生字幕');
    record('Hidden Trancy falls back to native captions, enables CC once, preserves fragments and line breaks');

    await page.evaluate(() => {
      window.detachedTrancy = document.querySelector('trancy-caption-window');
      detachedTrancy.remove();
      document.querySelector('.ytp-caption-segment').textContent = 'Real';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Reallo world.\nSecond line.');
    record('Native caption updates work with Trancy completely absent');

    await page.evaluate(() => {
      document.querySelector('.ytp-subtitles-button').click();
      // Retained native caption nodes must not leak text after CC is off.
      document.querySelector('.ytp-caption-window-container').hidden = false;
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === '');
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => testCCClicks), 2);
    assert.ok((await pipValue('tf-empty')).includes('YouTube 字幕（CC）'));
    record('Manual CC off clears retained text and is not repeatedly overridden');

    await page.evaluate(() => {
      document.querySelector('.ytp-subtitles-button').click();
      document.querySelector('.captions-text').replaceChildren();
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-empty').textContent === '当前没有字幕，等待下一句…');
    assert.equal(await pipValue('tf-original'), '');
    await page.evaluate(() => {
      const old = document.querySelector('.ytp-caption-window-container');
      const replacement = old.cloneNode(false);
      replacement.innerHTML = '<div class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment">Replacement caption</span></span></div>';
      old.replaceWith(replacement);
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Replacement caption');
    record('Native cue gaps clear text and replaced caption containers are rediscovered');

    await page.evaluate(() => document.querySelector('#movie_player').classList.add('ad-showing'));
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === '');
    await page.evaluate(() => document.querySelector('#movie_player').classList.remove('ad-showing'));
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Replacement caption');
    record('Advertisements suppress native fallback captions too');

    await page.evaluate(() => {
      document.querySelector('#movie_player').append(detachedTrancy);
      document.querySelector('.trancy-caption-content').hidden = false;
      document.querySelector('.trancy-caption-primary').textContent = 'Trancy is back.';
      const translated = document.querySelector('.trancy-caption-secondary');
      translated.classList.remove('ai-loading'); translated.textContent = '双语字幕恢复。';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-translation').textContent === '双语字幕恢复。');
    assert.equal(await pipValue('tf-original'), 'Trancy is back.');
    await page.evaluate(() => {
      document.querySelector('.trancy-caption-primary').textContent = '';
      document.querySelector('.trancy-caption-secondary').textContent = '';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === '');
    assert.equal((await read()).trancyActive, true);
    record('Trancy resumes priority; empty Trancy cues never mix in native captions');

    await page.evaluate(() => {
      document.querySelector('.trancy-caption-primary').textContent = 'Trancy active';
      document.querySelector('.ytp-subtitles-button').click();
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Trancy active');
    await page.evaluate(() => { document.querySelector('.trancy-caption-content').hidden = true; });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Replacement caption');
    assert.equal(await page.evaluate(() => testCCClicks), 5);
    record('Turning Trancy off again re-enters native mode and enables CC once');
    await page.evaluate(() => {
      document.querySelector('.ytp-subtitles-button').remove();
      document.querySelector('.ytp-caption-window-container').remove();
    });

    await page.evaluate(() => {
      const host = document.querySelector('trancy-caption-window'); host.replaceChildren();
      const shadow = host.attachShadow({mode:'open'});
      shadow.innerHTML = '<div class="trancy-caption-content"><div class="trancy-caption-primary">Shadow subtitle</div><div class="trancy-caption-secondary">影子节点字幕</div></div>';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Shadow subtitle');
    record('Open Shadow DOM subtitles are supported');

    await page.evaluate(() => {
      document.querySelector('trancy-caption-window').remove();
      const app = document.createElement('trancy-app');
      app.innerHTML = '<div class="trancy-subtitle-container"><div class="trancy-subtitle-wrapper"><div class="trancy-primary-subtitle">OLD LINE</div></div><div class="trancy-subtitle-wrapper active"><div class="trancy-primary-subtitle">Active lesson line</div><div class="trancy-secondary-subtitle">当前学习句子</div></div><div class="trancy-subtitle-wrapper"><div class="trancy-primary-subtitle">FUTURE LINE</div></div></div>';
      document.body.append(app);
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Active lesson line');
    assert.equal((await read()).translation, '当前学习句子');
    record('Learning-mode adapter selects only the active row');
    await page.evaluate(() => document.querySelector('#movie_player').classList.add('ad-showing'));
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === '');
    await page.evaluate(() => document.querySelector('#movie_player').classList.remove('ad-showing'));
    record('Advertisements suppress stale lesson captions');

    await page.evaluate(() => {
      document.querySelector('.trancy-primary-subtitle').textContent = '<img src=x onerror=alert(1)>';
      document.querySelector('.trancy-subtitle-wrapper.active .trancy-primary-subtitle').textContent = '<script>window.stolen=true</script>';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent.includes('<script>'));
    assert.equal(await page.evaluate(() => !!documentPictureInPicture.window.document.querySelector('script,img')), false);
    record('Caption markup is rendered as inert text, never HTML');

    await page.evaluate(() => {
      document.querySelector('.trancy-subtitle-wrapper.active .trancy-primary-subtitle').textContent = 'Small steps, every single day.';
      document.querySelector('.trancy-subtitle-wrapper.active .trancy-secondary-subtitle').textContent = '每天进步一点点。';
    });
    await page.waitForFunction(() => documentPictureInPicture.window.document.getElementById('tf-original').textContent === 'Small steps, every single day.');
    // Render the exact generated PiP document for visual QA if headless PiP has no Page target.
    const rendered = await page.evaluate(() => documentPictureInPicture.window.document.documentElement.outerHTML);
    const preview = await context.newPage(); await preview.setViewportSize({ width: 1040, height: 130 });
    await preview.setContent(rendered);
    // Preview the requested shallow layout at the user's smaller display sizes.
    await preview.evaluate(() => {
      document.documentElement.style.setProperty('--original-size', '24px');
      document.documentElement.style.setProperty('--translation-size', '20px');
    });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await preview.screenshot({ path: path.join(root, 'test-results', 'floating-window.png') });
    await preview.locator('summary').click();
    const panel = preview.locator('.sizes');
    assert.ok((await panel.boundingBox()).y >= 0, 'Settings must stay inside a shallow window');
    await preview.locator('#tf-windowWidth').scrollIntoViewIfNeeded();
    await preview.screenshot({ path: path.join(root, 'test-results', 'settings-shallow.png') });
    await preview.setViewportSize({ width: 1040, height: 320 });
    await preview.screenshot({ path: path.join(root, 'test-results', 'settings.png') });
    record('Settings panel stays within a shallow window and width controls can be scrolled into view');
    await preview.close();

    await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-compact').click());
    assert.equal(await page.evaluate(() => testStorage.compactMode), true);
    const compactMarkup = await page.evaluate(() => documentPictureInPicture.window.document.documentElement.outerHTML);
    const compactPreview = await context.newPage();
    await compactPreview.setViewportSize({ width: 680, height: 280 });
    await compactPreview.setContent(compactMarkup);
    await compactPreview.mouse.move(-10, -10);
    await compactPreview.waitForFunction(() => getComputedStyle(document.querySelector('header')).visibility === 'hidden');
    assert.equal(await compactPreview.locator('footer').isVisible(), false);
    const subtitleBounds = await compactPreview.locator('#tf-original').boundingBox();
    assert.equal((await compactPreview.locator('main').boundingBox()).height, 280);
    await compactPreview.screenshot({ path: path.join(root, 'test-results', 'compact-idle.png') });
    await compactPreview.mouse.move(340, 140);
    await compactPreview.waitForFunction(() => getComputedStyle(document.querySelector('header')).opacity === '1');
    assert.equal(await compactPreview.locator('footer').isVisible(), true);
    assert.deepEqual(await compactPreview.locator('#tf-original').boundingBox(), subtitleBounds);
    await compactPreview.screenshot({ path: path.join(root, 'test-results', 'compact-hover.png') });
    // Clicking a control must not pin both bars open after the pointer leaves.
    await compactPreview.locator('#tf-compact').click();
    await compactPreview.mouse.move(-10, -10);
    await compactPreview.waitForFunction(() => getComputedStyle(document.querySelector('header')).visibility === 'hidden');
    await compactPreview.close();
    record('Compact hover reveals both bars without moving captions; mouse exit hides clicked controls');

    await page.evaluate(() => {
      const doc = documentPictureInPicture.window.document;
      doc.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true}));
    });
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.body.classList.contains('keyboard-controls')), true);
    await page.evaluate(() => {
      const doc = documentPictureInPicture.window.document;
      doc.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      doc.getElementById('tf-compact').click();
    });
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.body.classList.contains('compact')), false);
    assert.equal(await page.evaluate(() => testStorage.compactMode), false);
    await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-compact').click());
    record('Compact mode supports keyboard access and can be switched off');

    await page.evaluate(() => documentPictureInPicture.window.close());
    await page.waitForFunction(() => !documentPictureInPicture.window);
    await page.locator('#trancy-float-launcher button').click();
    await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('#tf-original'));
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-windowWidth').value), '1920');
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.getComputedStyle(documentPictureInPicture.window.document.querySelector('main')).rowGap), '12px');
    record('Width target and bilingual gap survive closing and reopening');
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.documentElement.style.getPropertyValue('--translation-size')), '40px');
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.body.classList.contains('compact')), true);
    assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.getElementById('tf-compact').getAttribute('aria-pressed')), 'true');
    record('Compact mode preference survives closing and reopening the native PiP window');
    record('Closing/reopening cleans up and keeps font preferences');
    await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-start')));
    await page.waitForFunction(() => !documentPictureInPicture.window);
    record('YouTube navigation closes the previous video subtitle window');
    assert.deepEqual(errors, []);
    record('No uncaught JavaScript errors');
    fs.writeFileSync(path.join(root, 'test-results', 'results.json'), JSON.stringify({ browser: browser.version(), tests: reports, note: 'Synthetic Trancy 7.9.4 markup, real Chrome Document PiP and native media. User-installed Trancy and minimized Windows session not tested.' }, null, 2));
    console.log(`${reports.length} checks passed.`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
