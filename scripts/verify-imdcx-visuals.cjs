/* Read-only browser smoke check. Uses the real page with a local Socket.IO fixture;
   never starts the game server or writes player data. Node 22+ and Chrome required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createProgression, xpForLevel } = require('../lib/progression');
const { registerProgressionSocket } = require('../lib/progression-sockets');
const reviewEntries = Object.create(null);
const reviewEngine = createProgression({ getEntries: () => reviewEntries, ensureEntry: name => reviewEntries[name] ||= { name, points: 0, level: 'Q1', multiplier: null }, save() {} });
const reviewNames = ['LionHeart', 'ShadowAce', 'QueenNaya', 'PokerPanda', 'NovaKing', 'BluffQueen', 'Valentin', 'RiverMan', 'CardWizard', 'AllInMax'];
reviewNames.forEach((name, index) => {
  reviewEngine.profile(name);
  const entry = reviewEntries[name];
  entry.points = [312680, 248750, 201430, 178920, 165430, 154210, 149360, 142880, 138210, 128900][index];
  entry.multiplier = [10, 5, 2, 5, 5, 2, 5, 2, 2, 3][index];
  entry.progression.xp = xpForLevel([58, 42, 37, 35, 33, 31, 28, 27, 26, 24][index]) + 120;
  entry.progression.games.table = { played: 1000, wins: 640 - index * 21 };
  entry.progression.currentStreak = index === 6 ? 7 : 3;
  entry.progression.bestStreak = 9;
  entry.progression.customization.avatar = ['crown', 'shield', 'diamond', 'spade', 'ace', 'comet'][index % 6];
  entry.progression.week.points = 1000 - index * 40;
});
reviewEntries.Valentin.progression.friends = ['LionHeart', 'QueenNaya'];
reviewEntries.Valentin.progression.daily.played = 3;
reviewEntries.Valentin.progression.daily.wins = 3;
reviewEntries.Valentin.progression.daily.bestStreak = 3;
const reviewHandlers = {};
registerProgressionSocket({ on(event, fn) { reviewHandlers[event] = fn; } }, { engine: reviewEngine, resolveName: () => 'Valentin', bindIdentity: () => 'Valentin', hasPlayer: name => !!reviewEntries[name], rateLimit: 1000 });
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'home-luxury-review');
fs.mkdirSync(output, { recursive: true });

// The local scope snapshot excludes the home presentation being edited. It protects
// live behavior files and the existing battle/wheel rules without touching data.
function protectedCssRules(source, ancestry = []) {
  const rules = [];
  let start = 0, depth = 0, open = -1, quote = '', comment = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index], next = source[index + 1];
    if (comment) { if (character === '*' && next === '/') { comment = false; index++; } continue; }
    if (quote) { if (character === '\\') { index++; continue; } if (character === quote) quote = ''; continue; }
    if (character === '/' && next === '*') { comment = true; index++; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') { if (depth === 0) open = index; depth++; }
    if (character !== '}' || --depth !== 0) continue;
    const selector = source.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = source.slice(open + 1, index);
    if (selector.startsWith('@media')) rules.push(...protectedCssRules(body, [...ancestry, selector]));
    else rules.push({ ancestry, selector, body: body.replace(/\r\n/g, '\n') });
    start = index + 1;
  }
  return rules;
}
function verifyHomeScope(check) {
  const baselinePath = path.join(output, 'scope-baseline.json');
  if (!fs.existsSync(baselinePath)) return;
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  for (const [file, digest] of Object.entries(baseline.files)) {
    check(`Home-only scope preserves ${file}`, sha256(fs.readFileSync(path.join(root, file))) === digest);
  }
  const visual = fs.readFileSync(path.join(root, baseline.protectedVisuals.path), 'utf8');
  const homeBoundary = visual.includes('  // Home motion has its own lifecycle') ? visual.indexOf('  // Home motion has its own lifecycle') : visual.indexOf('  function home(root)');
  check('Home-only scope preserves shared parallax', sha256(visual.slice(0, homeBoundary)) === baseline.protectedVisuals.beforeHomeSha256);
  check('Home-only scope preserves battle and wheel presentation logic', sha256(visual.slice(visual.indexOf('  function battle(root)'))) === baseline.protectedVisuals.fromBattleToEndSha256);
  const rules = protectedCssRules(fs.readFileSync(path.join(root, baseline.protectedCss.path), 'utf8'));
  check('Home-only scope preserves all existing battle, wheel and shared CSS rules', baseline.protectedCss.rules.every(expected => rules.some(actual => actual.selector === expected.selector && JSON.stringify(actual.ancestry) === JSON.stringify(expected.ancestry) && actual.body === expected.body)));
}
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
    emit(event, payload, ack) {
      window.__sent.push({ event, payload });
      if (event.startsWith('progression:')) fetch('/__progression', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, payload }) }).then(r => r.json()).then(response => { ack?.(response); if (response.ok && /:(claimMission|claimLogin|friend|customize|chooseMultiplier)$/.test(event)) window.__receive('progression:updated', { dashboard: response.data }); });
      if (event === 'getHomeProfile') setTimeout(() => window.__receive('homeProfile', { points: 240, rank: 3, totalRanked: 42, multiplier: 2, gamesPlayed: 20, wins: 13, winRate: 65, table: { played: 12, wins: 8 }, duel: { played: 8, wins: 5 } }), 10);
      if (event === 'startPracticeBattle') window.__receive('battleStart', { practice: true, opponentLabel: 'Alexandre', round: 1, scoreMine: 0, scoreTheirs: 0 });
      if (event === 'previewSpinWheel') window.__receive('wheelResult', { multiplier: 5, preview: true });
      return this;
    }
  };
  setTimeout(() => window.__receive('connect'), 20);
  return socket;
};`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__progression' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { event, payload } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!reviewHandlers[event]) return res.end(JSON.stringify({ ok: false, error: 'Unknown fixture event' }));
      reviewHandlers[event](payload, response => res.end(JSON.stringify(response)));
    });
    return;
  }
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
      await cdp('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    }
    async function flushMediaChange() {
      // Headless emulation can invalidate CSS before dispatching MediaQueryList's
      // change event. Advance the browser lifecycle rather than only sleeping Node.
      await evaluate("new Promise(resolve => { document.querySelector('.home-app').getBoundingClientRect(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))); })");
    }
    const checks = [];
    function check(name, value) { assert(value, name); checks.push(name); }
    verifyHomeScope(check);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    console.log('Chrome connected');
    await viewport(1440, 900);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('playername', 'Valentin');" });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/poker.html` });
    for (let i = 0; i < 100; i++) { if (await evaluate("!!document.querySelector('.imdcx-home')")) break; await delay(100); }
    await evaluate('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))])');
    await delay(1100);
    check('Real home initializes and displays competitive profile data', await evaluate("document.querySelector('#stat-points').textContent === '149360'"));
    check('Home scene is decorative and initialized once', await evaluate("document.querySelectorAll('.home-scene').length === 1 && document.querySelector('.home-scene').inert && document.querySelector('.home-scene').getAttribute('aria-hidden') === 'true' && document.querySelectorAll('.stat-tile .home-surface-light').length === 4"));
    const metrics = await evaluate(`(() => { const home = document.querySelector('.home-app'); const nav = home.querySelector('.home-nav-row').getBoundingClientRect(); return { client: home.clientHeight, scroll: home.scrollHeight, navBottom: nav.bottom, width: home.clientWidth, scrollWidth: home.scrollWidth }; })()`);
    console.log('Desktop layout:', metrics);
    await screenshot('home-desktop');
    check('Desktop home fits the viewport', metrics.scroll <= metrics.client + 1 && metrics.scrollWidth <= metrics.width);
    check('Desktop stats flank the central play area', await evaluate("(() => { const box = s => document.querySelector(s).getBoundingClientRect(); const play = box('.home-play-card'); return ['.stat-points', '.stat-rank'].every(s => box(s).right < play.left) && ['.stat-winrate', '.stat-mult'].every(s => box(s).left > play.right); })()"));
    const playPosition = await evaluate("(() => { const r = document.querySelector('.quickplay-btn').getBoundingClientRect(); return { x: r.left + r.width * .7, y: r.top + r.height * .3 }; })()");
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...playPosition });
    await delay(350);
    check('Play hover lifts and responds to pointer position', await evaluate("(() => { const button = document.querySelector('.quickplay-btn'); return getComputedStyle(button).getPropertyValue('--button-lift').trim() === '-4px' && button.style.getPropertyValue('--tilt-y') !== ''; })()"));
    check('Play reflection follows the cursor', await evaluate("(() => { const button = document.querySelector('.quickplay-btn'), light = button.querySelector('.home-surface-light'); return button.classList.contains('is-home-active') && parseFloat(light.style.getPropertyValue('--glare-x')) > 0 && parseFloat(light.style.getPropertyValue('--glare-y')) > 0; })()"));
    check('Room and floating props respond with distinct depth', await evaluate("(() => { const room = parseFloat(document.querySelector('.home-scene-room').style.getPropertyValue('--scene-x')), props = parseFloat(document.querySelector('.home-scene-props').style.getPropertyValue('--scene-x')); return Number.isFinite(room) && Math.abs(room) > .1 && Math.abs(props) > Math.abs(room) && Math.abs(props) <= 14; })()"));
    await delay(450);
    check('Home pointer rendering becomes idle after settling', await evaluate("new Promise(resolve => { let writes = 0; const observer = new MutationObserver(records => { writes += records.length; }); document.querySelectorAll('.home-scene-room, .home-scene-props, .quickplay-btn, .quickplay-btn .home-surface-light').forEach(element => observer.observe(element, { attributes: true, attributeFilter: ['style'] })); setTimeout(() => { observer.disconnect(); resolve(writes === 0); }, 250); })"));
    await screenshot('home-hover');
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...playPosition });
    await delay(250);
    check('Play presses inward', await evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.quickplay-btn')).transform).m42 >= 3.9"));
    check('Pointer press adds physical feedback', await evaluate("document.querySelector('.quickplay-btn').classList.contains('is-home-pressed')"));
    await screenshot('home-pressed');
    // Release outside the button so the dedicated existing action check below owns the click.
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 15, y: 100 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 15, y: 100 });
    await evaluate("document.querySelector('.home-app').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))");
    await delay(700);
    check('Leaving the home clears tilt, reflection and scene displacement', await evaluate("!document.querySelector('.home-app .is-home-active, .home-app .is-home-pressed') && Array.from(document.querySelectorAll('.home-scene-room, .home-scene-props')).every(element => !element.style.getPropertyValue('--scene-x')) && !document.querySelector('.quickplay-btn').style.getPropertyValue('--tilt-y') && !document.querySelector('.quickplay-btn .home-surface-light').style.getPropertyValue('--glare-x')"));
    const statPosition = await evaluate("(() => { const r = document.querySelector('.stat-points').getBoundingClientRect(); return { x: r.left + r.width * .8, y: r.top + r.height * .2 }; })()");
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...statPosition });
    await delay(350);
    check('Stat cards respond independently to pointer movement', await evaluate("document.querySelector('.stat-points').classList.contains('is-home-active') && Math.abs(parseFloat(document.querySelector('.stat-points').style.getPropertyValue('--tilt-y'))) > .5 && !document.querySelector('.quickplay-btn').classList.contains('is-home-active')"));
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await flushMediaChange();
    await delay(150);
    const reducedHome = await evaluate("(() => { const home = document.querySelector('.home-app'); return { media: matchMedia('(prefers-reduced-motion: reduce)').matches, paused: home.classList.contains('is-home-paused'), activeSurface: !!home.querySelector('.is-home-active'), sceneX: home.querySelector('.home-scene-room').style.getPropertyValue('--scene-x'), runningAnimations: home.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => ({ type: animation.constructor.name, name: animation.animationName || animation.transitionProperty, target: animation.effect?.target?.className, pseudo: animation.effect?.pseudoElement, time: animation.currentTime, duration: animation.effect?.getTiming().duration })) }; })()");
    if (!reducedHome.paused || reducedHome.activeSurface || reducedHome.sceneX || reducedHome.runningAnimations.length) console.log('Reduced-motion home diagnostics:', reducedHome);
    check('Changing reduced-motion preference immediately resets home motion', reducedHome.media && reducedHome.paused && !reducedHome.activeSurface && !reducedHome.sceneX && reducedHome.runningAnimations.length === 0);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...playPosition });
    await delay(150);
    check('Reduced motion prevents pointer-driven effects', await evaluate("!document.querySelector('.quickplay-btn').style.getPropertyValue('--tilt-y') && !document.querySelector('.home-scene-props').style.getPropertyValue('--scene-x')"));
    await cdp('Emulation.setEmulatedMedia', { features: [] });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await flushMediaChange();
    await delay(150);
    check('Coarse touch pointers pause decorative home motion', await evaluate("!matchMedia('(hover: hover) and (pointer: fine)').matches && document.querySelector('.home-app').classList.contains('is-home-paused')"));
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await flushMediaChange();
    await delay(150);
    check('Returning to a fine pointer restores home motion availability', await evaluate("matchMedia('(hover: hover) and (pointer: fine)').matches && !document.querySelector('.home-app').classList.contains('is-home-paused')"));
    await evaluate("document.querySelector('.home-app').hidden = true");
    await delay(100);
    check('Hiding the home suspends its decorative motion', await evaluate("document.querySelector('.home-app').classList.contains('is-home-paused') && !document.querySelector('.home-scene-props').style.getPropertyValue('--scene-x')"));
    await evaluate("document.querySelector('.home-app').hidden = false");
    await evaluate("document.querySelector('.quickplay-btn').click()");
    check('Play click gives brief light feedback while retaining the action', await evaluate("document.querySelector('.quickplay-btn').classList.contains('is-home-clicked')"));
    check('Play still emits quickJoin with the entered name', await evaluate("__sent.some(s => s.event === 'quickJoin' && s.payload.name === 'Valentin')"));
    check('Disabled Play cannot trigger another join', await evaluate("(() => { const before = __sent.filter(item => item.event === 'quickJoin').length; document.querySelector('.quickplay-btn').click(); return document.querySelector('.quickplay-btn').disabled && __sent.filter(item => item.event === 'quickJoin').length === before; })()"));
    await evaluate("__receive('joinError', 'Connexion impossible, réessayez.');");
    check('Existing connection feedback reenables Play', await evaluate("!document.querySelector('.quickplay-btn').disabled && document.querySelector('.quickplay-status').textContent.includes('Connexion')"));
    await evaluate("document.querySelector('.quickplay-name').focus()");
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    check('Keyboard navigation reaches Play with visible focus', await evaluate("document.activeElement === document.querySelector('.quickplay-btn') && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2"));
    await screenshot('home-keyboard-focus');
    await evaluate("document.activeElement?.blur(); document.querySelector('.quickplay-status').textContent = ''");
    await evaluate("document.querySelector('#nav-settings-btn').click()");
    check('Settings navigation still opens its existing modal', await evaluate("!document.querySelector('.settings-modal').hidden"));
    await evaluate("document.querySelector('.settings-modal .modal-close').click()");
    await evaluate("document.querySelector('#nav-classement-btn').click()");
    await delay(600);
    check('Opening progression pauses the inert home background', await evaluate("document.querySelector('.home-app').inert && document.querySelector('.home-app').classList.contains('is-home-paused') && !document.querySelector('.home-scene-room').style.getPropertyValue('--scene-x') && document.querySelector('.home-app').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')"));
    check('Ranking opens with real engine top three and own row', await evaluate("document.querySelectorAll('.progression-podium-card').length === 3 && document.querySelector('.progression-table').textContent.includes('Valentin')"));
    check('Ranking header and navigation remain at the top of the viewport', await evaluate("document.querySelector('.progression-topbar').getBoundingClientRect().top === 0 && document.querySelector('.progression-sidebar').getBoundingClientRect().top < 120"));
    await screenshot('progression-ranking-desktop');
    await evaluate("document.querySelector('[data-category=weekly]').click()");
    await delay(200);
    check('Weekly ranking switches to weekly points', await evaluate("document.querySelector('[data-category=weekly]').getAttribute('aria-selected') === 'true' && document.querySelector('.progression-podium-score').textContent === '1 000'"));
    await evaluate("document.querySelector('[data-category=friends]').click()");
    await delay(200);
    check('Friends ranking contains the player and selected friends only', await evaluate("Array.from(document.querySelectorAll('.progression-podium-name'), n => n.textContent).join(',') === 'LionHeart,QueenNaya,ValentinVOUS' && !document.querySelector('.progression-table')"));
    await evaluate("IMDCXProgression.open('profile')");
    check('Own profile includes XP, achievements and customization', await evaluate("!!document.querySelector('[data-progression-form=customize]') && document.querySelector('.progression-player-card').textContent.includes('Valentin') && document.querySelectorAll('.progression-achievement').length > 3"));
    check('Cosmetic selectors stay inside the customization form', await evaluate("(() => { const form = document.querySelector('[data-progression-form=customize]').getBoundingClientRect(); return Array.from(document.querySelectorAll('.progression-form-row select')).every(el => { const r = el.getBoundingClientRect(); return r.top >= form.top && r.bottom <= form.bottom; }); })()"));
    await screenshot('progression-profile-desktop');
    await evaluate("(() => { const form = document.querySelector('[data-progression-form=customize]'); form.querySelector('[name=avatar][value=diamond]').checked = true; form.requestSubmit(); })()");
    await delay(250);
    check('Avatar selection persists in server data', reviewEngine.profile('Valentin').avatar === 'diamond');
    await evaluate("IMDCXProgression.open('profile', 'LionHeart')");
    check('Other profile exposes friendship instead of customization', await evaluate("!document.querySelector('[data-progression-form=customize]') && !!document.querySelector('[data-progression-action=friend]')"));
    await evaluate("document.querySelector('[data-progression-action=friend]').click()");
    await delay(200);
    check('Remove friend updates persisted list', !reviewEngine.profile('Valentin').friends.includes('LionHeart'));
    await evaluate("IMDCXProgression.open('daily')");
    check('Daily hub displays seven login days and three missions', await evaluate("document.querySelectorAll('.progression-login-day').length === 7 && document.querySelectorAll('.progression-mission').length === 3"));
    await screenshot('progression-daily-desktop');
    const beforeLogin = reviewEngine.profile('Valentin').xp;
    await evaluate("document.querySelector('[data-progression-action=claim-login]').click()");
    await delay(250);
    check('Login claim grants XP and disables repeat claim', reviewEngine.profile('Valentin').xp === beforeLogin + 50 && await evaluate("document.querySelector('[data-progression-action=claim-login]').disabled"));
    const beforeMission = reviewEngine.profile('Valentin').xp;
    await evaluate("document.querySelector('[data-progression-action=claim-mission]').click()");
    await delay(250);
    check('Completed mission grants its XP once', reviewEngine.profile('Valentin').xp === beforeMission + 150 && await evaluate("document.querySelector('[data-progression-action=claim-mission]').disabled"));
    reviewEntries.Valentin.progression.xp = xpForLevel(29) - 20;
    await evaluate('IMDCXProgression.refresh()');
    const levelReceipt = reviewEngine.claimMission('Valentin', 'battle_win_1');
    await evaluate(`__receive('progression:updated', ${JSON.stringify({ dashboard: reviewEngine.dashboard('Valentin'), receipt: levelReceipt })})`);
    check('Server reward triggers a level-up celebration', await evaluate("document.querySelector('.progression-toast-level')?.textContent.includes('Niveau 29 atteint')"));
    check('Level reward is reflected in the home total', await evaluate(`document.querySelector('#stat-points').textContent === '${reviewEngine.profile('Valentin').points}'`));
    reviewEntries.Valentin.needsWheelSpin = true;
    reviewEngine.spin('Valentin', 2);
    await evaluate(`IMDCXProgression.showMultiplierChoice(${JSON.stringify(reviewEngine.dashboard('Valentin').pendingMultiplier)})`);
    await screenshot('progression-multiplier-choice');
    await evaluate("document.querySelector('[data-choice=keep]').click()");
    await delay(250);
    check('Keep multiplier resolves the persisted wheel choice', reviewEngine.profile('Valentin').multiplier === 5 && !reviewEngine.dashboard('Valentin').pendingMultiplier && await evaluate("!document.querySelector('#progression-choice')"));
    await viewport(1672, 941);
    await evaluate("IMDCXProgression.open('leaderboard');");
    await evaluate("document.querySelector('[data-category=global]').click()");
    await delay(250);
    const rankingLayout = await evaluate("Object.fromEntries(['.progression-app','.progression-main','.progression-page-heading','.progression-topbar'].map(s => { const el = document.querySelector(s), rect = el.getBoundingClientRect(), css = getComputedStyle(el); return [s, { top: rect.top, height: rect.height, scroll: el.scrollTop, transform: css.transform, gridRow: css.gridRow, paddingTop: css.paddingTop }]; }))");
    console.log('Ranking layout:', rankingLayout);
    check('Ranking title stays visible after category navigation', rankingLayout['.progression-page-heading'].top >= 0);
    await evaluate("document.querySelectorAll('.progression-toast').forEach(el => el.remove())");
    await screenshot('progression-ranking-reference');
    for (const [width, height] of [[390, 844], [320, 568], [844, 390], [1024, 768]]) {
      await viewport(width, height, width < 900);
      for (const view of ['leaderboard', 'profile', 'daily']) {
        await evaluate(`IMDCXProgression.open('${view}')`);
        check(`${view} remains horizontally contained at ${width}x${height}`, await evaluate("(() => { const app = document.querySelector('.progression-app'); const main = document.querySelector('.progression-main'); return app.scrollWidth <= app.clientWidth + 1 && main.scrollWidth <= main.clientWidth + 1; })()"));
        if (width === 390) await screenshot(`progression-${view}-mobile`);
      }
    }
    await viewport(1440, 900);
    await evaluate("IMDCXProgression.close()");
    check('Closing progression restores home interactions', await evaluate("!document.querySelector('.home-app').inert"));
    await delay(100);
    check('Closing progression restores home motion availability', await evaluate("!document.querySelector('.home-app').classList.contains('is-home-paused')"));
    for (const [button, content] of [['home-avatar-btn', '.progression-player-card'], ['home-profile-btn', '.progression-player-card'], ['home-daily-btn', '.progression-mission']]) {
      await evaluate(`document.getElementById('${button}').click()`);
      await delay(150);
      check(`${button} retains its existing destination`, await evaluate(`!!document.querySelector('${content}')`));
      await evaluate('IMDCXProgression.close()');
    }
    for (const button of ['nav-stats-btn']) {
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
    check('Wheel uses all four competitive rewards', await evaluate("Array.from(document.querySelectorAll('.wheel-seg-label'), el => el.dataset.value).join(',') === '1,2,5,10'"));
    check('Wheel lands on x5 and highlights the same segment', await evaluate("document.querySelector('.premium-wheel-segment.is-winner').dataset.value === '5' && document.querySelector('.wheel-seg-label.is-winner').textContent === 'x5' && document.querySelector('#wheel-disc').style.transform === 'rotate(1935deg)' && document.querySelector('#wheel-status').textContent.includes('aucun multiplicateur')"));
    await screenshot('wheel-desktop');
    // Verify every possible server-selected landing, with reduced motion and actual handlers.
    await evaluate("document.querySelector('.imdcx-wheel').remove()");
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const [value, rotation] of [[1, 2115], [2, 2025], [5, 1935], [10, 1845]]) {
      check(`Reduced motion lands exactly on x${value}`, await evaluate(`(() => { const root = ensureWheelOverlay(); const segment = WHEEL_SEGMENTS.find(s => s.value === ${value}); IMDCXVisuals.spin(root, segment, ${rotation}, 3200); const ok = root.querySelector('.premium-wheel-segment.is-winner').dataset.value === '${value}' && root.querySelector('#wheel-disc').style.transform === 'rotate(${rotation}deg)' && root.getAnimations({ subtree: true }).length === 0; root.remove(); return ok; })()`));
    }
    for (const [width, height] of [[1672, 941], [1913, 838], [1280, 720], [1024, 768]]) {
      await viewport(width, height);
      await evaluate("document.activeElement?.blur(); document.querySelector('.home-app').scrollTop = 0");
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      check(`Home fits desktop ${width}×${height}`, await evaluate("(() => { const el = document.querySelector('.home-app'); return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth; })()"));
      if (width === 1913) await screenshot('home-wide');
      if (width === 1672) await screenshot('home-reference');
    }
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await viewport(width, height, true);
      await evaluate("document.activeElement?.blur(); document.querySelector('.home-app').scrollTop = 0");
      await delay(150);
      check(`Home has no horizontal overflow at ${width}×${height}`, await evaluate("document.querySelector('.home-app').scrollWidth <= document.querySelector('.home-app').clientWidth"));
      check(`Navigation labels remain visible at ${width}×${height}`, await evaluate("Array.from(document.querySelectorAll('.home-nav-card > span:not([aria-hidden])')).every(el => el.clientHeight >= 10 && el.scrollWidth <= el.clientWidth + 1)"));
      if (width === 390) {
        await screenshot('home-mobile');
        await evaluate("(() => { const home = document.querySelector('.home-app'); home.scrollTop = home.scrollHeight; })()");
        await delay(150);
        check('Mobile navigation remains reachable by scrolling the home', await evaluate("(() => { const nav = document.querySelector('.home-nav-row').getBoundingClientRect(); return nav.top >= 0 && nav.bottom <= innerHeight + 1; })()"));
        await screenshot('home-mobile-lower');
        await evaluate("document.querySelector('.home-app').scrollTop = 0");
      }
      await evaluate("(() => { const name = document.querySelector('.quickplay-name'), level = document.getElementById('home-progression-level'), resume = document.getElementById('home-resume-btn'); window.__homeHeaderBefore = { name: name.value, level: level.textContent, resume: resume.textContent, hidden: resume.hidden }; name.value = 'ValentinPokerChampion2026'; level.textContent = 'Niv. 100 · IMDCX Master'; resume.textContent = 'Choisir mon multiplicateur'; resume.hidden = false; })()");
      check(`Long profile label and pending reward remain contained at ${width}×${height}`, await evaluate("(() => { const home = document.querySelector('.home-app'); return home.scrollWidth <= home.clientWidth + 1 && Array.from(document.querySelectorAll('.home-topbar button:not([hidden])')).every(button => { const r = button.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && button.scrollWidth <= button.clientWidth + 1; }); })()"));
      check(`Mobile header controls remain distinct at ${width}×${height}`, await evaluate("(() => { const nodes = Array.from(document.querySelectorAll('.home-brand, .home-topbar button:not([hidden])')), boxes = nodes.map(node => node.getBoundingClientRect()); return boxes.every((a, i) => boxes.slice(i + 1).every(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1)); })()"));
      if (width === 390) await screenshot('home-mobile-pending-reward');
      await evaluate("(() => { const previous = window.__homeHeaderBefore; document.querySelector('.quickplay-name').value = previous.name; document.getElementById('home-progression-level').textContent = previous.level; const resume = document.getElementById('home-resume-btn'); resume.hidden = previous.hidden; resume.textContent = previous.resume; })()");
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
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, desktop: metrics, performanceLimit: 'Headless Chrome uses --disable-gpu. These checks verify idle rendering and motion behavior, not physical-device frame rate.' }, null, 2));
    console.log(`${checks.length} checks passed. Screenshots: ${output}`);
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
  }
}
if (process.argv.includes('--scope-only')) {
  let count = 0;
  verifyHomeScope((name, value) => { assert(value, name); count++; });
  console.log(`${count} protected scope checks passed.`);
} else main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
