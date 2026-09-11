/* Read-only browser smoke check. Uses the real page with a local Socket.IO fixture;
   never starts the game server or writes player data. Node 22+ and Chrome required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'imdcx-review');
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `
window.__sent = [];
window.__receive = (event, payload) => (window.__handlers[event] || []).forEach(fn => fn(payload));
window.io = () => {
  window.__handlers = {};
  const socket = {
    connected: true, id: 'visual-review',
    on(event, fn) { (window.__handlers[event] ||= []).push(fn); return this; },
    off() { return this; },
    emit(event, payload) {
      window.__sent.push({ event, payload });
      if (event === 'getHomeProfile') setTimeout(() => window.__receive('homeProfile', { points: 240, rank: 3, totalRanked: 42, multiplier: 2, gamesPlayed: 20, wins: 13, winRate: 65, table: { played: 12, wins: 8 }, duel: { played: 8, wins: 5 } }), 10);
      if (event === 'startPracticeBattle') window.__receive('battleStart', { practice: true, opponentLabel: 'Alexandre', round: 1, scoreMine: 0, scoreTheirs: 0 });
      if (event === 'previewSpinWheel') window.__receive('wheelResult', { multiplier: 5, preview: true });
      return this;
    }
  };
  setTimeout(() => window.__receive('connect'), 20);
  return socket;
};`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/socket.io/socket.io.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fixture); }
  const app = path.join(root, 'poker-app');
  const file = path.resolve(app, '.' + (url.pathname === '/' ? '/poker.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(app + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = path.join(output, `chrome-${process.pid}`);
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    chrome.on('error', error => console.error(error.message));
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
    assert(fs.existsSync(portFile), 'Chrome did not start');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.id) {
        const promise = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) promise.reject(new Error(message.error.message));
        else promise.resolve(message.result);
      }
    });
    function cdp(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
        pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        ws.send(JSON.stringify({ id: key, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    async function screenshot(name) {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
    }
    async function viewport(width, height, mobile = false) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    }
    const checks = [];
    function check(name, value) { assert(value, name); checks.push(name); }
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    console.log('Chrome connected');
    await viewport(1440, 900);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('playername', 'Valentin');" });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/poker.html` });
    for (let i = 0; i < 100; i++) { if (await evaluate("!!document.querySelector('.imdcx-home')")) break; await delay(100); }
    await evaluate('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))])');
    await delay(1100);
    check('Real home initializes and displays profile data', await evaluate("document.querySelector('#stat-points').textContent === '240'"));
    const metrics = await evaluate(`(() => { const home = document.querySelector('.home-app'); const nav = home.querySelector('.home-nav-row').getBoundingClientRect(); return { client: home.clientHeight, scroll: home.scrollHeight, navBottom: nav.bottom, width: home.clientWidth, scrollWidth: home.scrollWidth }; })()`);
    console.log('Desktop layout:', metrics);
    await screenshot('home-desktop');
    check('Desktop home fits the viewport', metrics.scroll <= metrics.client + 1 && metrics.scrollWidth <= metrics.width);
    await evaluate("document.querySelector('.quickplay-btn').click()");
    check('Play still emits quickJoin with the entered name', await evaluate("__sent.some(s => s.event === 'quickJoin' && s.payload.name === 'Valentin')"));
    await evaluate("__receive('joinError', 'Connexion impossible, réessayez.');");
    check('Existing connection feedback reenables Play', await evaluate("!document.querySelector('.quickplay-btn').disabled && document.querySelector('.quickplay-status').textContent.includes('Connexion')"));
    await evaluate("document.querySelector('#nav-settings-btn').click()");
    check('Settings navigation still opens its existing modal', await evaluate("!document.querySelector('.settings-modal').hidden"));
    await evaluate("document.querySelector('.settings-modal .modal-close').click()");
    for (const button of ['nav-classement-btn', 'nav-stats-btn']) {
      await evaluate(`document.getElementById('${button}').click()`);
      check(`${button} still opens its modal`, await evaluate("!!document.querySelector('.app-modal:not([hidden])')"));
      await evaluate("document.querySelector('.app-modal:not([hidden]) .modal-close').click()");
    }
    await evaluate("document.querySelector('#preview-battle-btn').click()");
    await delay(1250);
    check('Practice duel retains the opponent and playable action', await evaluate("document.querySelector('#battle-opponent-name').textContent === 'Alexandre' && !document.querySelector('#battle-play-btn').hidden"));
    await screenshot('battle-desktop');
    await evaluate("document.querySelector('#battle-play-btn').click()");
    check('Battle button emits the original practice event', await evaluate("__sent.some(s => s.event === 'playBattleRound' && s.payload.practice === true)"));
    await evaluate("__receive('battleRoundResult', { myCard: 's14', theirCard: 'h13', scoreMine: 1, scoreTheirs: 0, opponentLabel: 'Alexandre', roundWinner: 'me', matchOver: false, round: 2 });");
    await delay(750);
    check('Original card reveal still flips the correct image', await evaluate("document.querySelector('#battle-slot-mine .battle-card-flip').classList.contains('is-flipped') && document.querySelector('#battle-slot-mine img').src.endsWith('ace_of_spades.png')"));
    await screenshot('battle-revealed');
    await evaluate("document.querySelector('.imdcx-battle').remove()");
    await evaluate("document.querySelector('#preview-wheel-btn').click()");
    await delay(3500);
    check('Wheel preserves all four approved server rewards', await evaluate("Array.from(document.querySelectorAll('.wheel-seg-label'), el => el.dataset.value).join(',') === '2,3,5,10'"));
    check('Wheel lands on x5 and highlights the same segment', await evaluate("document.querySelector('.premium-wheel-segment.is-winner').dataset.value === '5' && document.querySelector('.wheel-seg-label.is-winner').textContent === 'x5' && document.querySelector('#wheel-disc').style.transform === 'rotate(1935deg)' && document.querySelector('#wheel-status').textContent.includes('aucun multiplicateur')"));
    await screenshot('wheel-desktop');
    // Verify every possible server-selected landing, with reduced motion and actual handlers.
    await evaluate("document.querySelector('.imdcx-wheel').remove()");
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const [value, rotation] of [[2, 2115], [3, 2025], [5, 1935], [10, 1845]]) {
      check(`Reduced motion lands exactly on x${value}`, await evaluate(`(() => { const root = ensureWheelOverlay(); const segment = WHEEL_SEGMENTS.find(s => s.value === ${value}); IMDCXVisuals.spin(root, segment, ${rotation}, 3200); const ok = root.querySelector('.premium-wheel-segment.is-winner').dataset.value === '${value}' && root.querySelector('#wheel-disc').style.transform === 'rotate(${rotation}deg)' && root.getAnimations({ subtree: true }).length === 0; root.remove(); return ok; })()`));
    }
    for (const [width, height] of [[1913, 838], [1280, 720]]) {
      await viewport(width, height);
      check(`Home fits desktop ${width}×${height}`, await evaluate("(() => { const el = document.querySelector('.home-app'); return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth; })()"));
      if (width === 1913) await screenshot('home-wide');
    }
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await viewport(width, height, true);
      await delay(150);
      check(`Home has no horizontal overflow at ${width}×${height}`, await evaluate("document.querySelector('.home-app').scrollWidth <= document.querySelector('.home-app').clientWidth"));
      check(`Navigation labels remain visible at ${width}×${height}`, await evaluate("Array.from(document.querySelectorAll('.home-nav-card span')).every(el => el.clientHeight >= 10 && el.scrollWidth <= el.clientWidth + 1)"));
      if (width === 390) await screenshot('home-mobile');
      await evaluate("__receive('battleStart', { practice: true, opponentLabel: 'Alexandre', round: 1, scoreMine: 0, scoreTheirs: 0 })");
      check(`Duel fits width at ${width}×${height}`, await evaluate("document.querySelector('.imdcx-battle').scrollWidth <= document.querySelector('.imdcx-battle').clientWidth"));
      if (width === 390) await screenshot('battle-mobile');
      await evaluate("document.querySelectorAll('.imdcx-battle').forEach(el => el.remove()); spinWheelTo(10, true)");
      check(`Wheel fits width at ${width}×${height}`, await evaluate("document.querySelector('.imdcx-wheel').scrollWidth <= document.querySelector('.imdcx-wheel').clientWidth"));
      if (width === 390) { await delay(3400); await screenshot('wheel-mobile'); }
      await evaluate("document.querySelector('.imdcx-wheel').remove()");
    }
    if (errors.length) console.error('Browser exceptions:', errors);
    check('No browser JavaScript exceptions', errors.length === 0);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, desktop: metrics }, null, 2));
    console.log(`${checks.length} checks passed. Screenshots: ${output}`);
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
  }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
