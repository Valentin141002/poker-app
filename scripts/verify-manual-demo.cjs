/* Real browser + real server, with fresh temporary databases. No live data is copied. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imdcx-demo-browser-'));
const tablePolish = process.argv.includes('--table-polish');
const output = path.join(root, 'build', tablePolish ? 'table-step1-review' : 'demo-review');
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, ws;

async function main() {
  fs.copyFileSync(path.join(root, 'server.js'), path.join(directory, 'server.js'));
  fs.cpSync(path.join(root, 'lib'), path.join(directory, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'poker-app'), path.join(directory, 'poker-app'), 'junction');
  const boot = `const http = require('http'); const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) { this.once('listening', () => process.send(this.address().port)); return listen.apply(this, args); };
    require(process.argv[1]);`;
  server = spawn(process.execPath, ['-e', boot, path.join(directory, 'server.js')], {
    cwd: directory, windowsHide: true, env: { ...process.env, PORT: '0', NODE_PATH: path.join(root, 'node_modules') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let logs = '';
  server.stderr.on('data', value => { logs += value; });
  server.stdout.on('data', value => { logs += value; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server timeout: ${logs}`)), 30000);
    server.once('message', value => { clearTimeout(timer); resolve(value); });
    server.once('error', reject);
  });
  console.log('Isolated server ready');
  const profile = path.join(directory, 'chrome');
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await delay(100);
  assert.ok(fs.existsSync(portFile), 'Chrome started');
  console.log('Chrome ready');
  const debugPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(expression)) return;
      if (errors.length) throw new Error(errors.join('\n'));
      await delay(100);
    }
    throw new Error(`Browser timed out: ${expression}`);
  };
  const screenshot = async name => {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const checks = [];
  const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(name); };
  if (tablePolish) {
    const metrics = [];
    const existingLimitations = new Set();
    for (const [width, height, mobile] of [[1920, 1080, false], [390, 844, true], [320, 740, true], [844, 390, true]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/poker.html?demo=10` });
      await wait("typeof currentGameState !== 'undefined' && currentGameState?.demo");
      await evaluate('window.__imdcxFinishPortalIntro?.()');
      await delay(5500);
      // Hide only the test toolbar for clean table reference captures.
      await evaluate("document.getElementById('manual-demo-tools').style.display = 'none'");
      for (const theme of ['forceDark', 'forceFruity']) {
        await evaluate(`backgroundThemeOverride = '${theme}'; applyTierBackgroundTheme(currentGameState); refreshResponsiveScaleAfterRender()`);
        await delay(5500);
        const info = await evaluate(`(() => {
          const ids = ['flop1','river','fold-button','call-button','custom-raise','odds-help-btn','sos-help-btn'];
          return { viewport: [innerWidth,innerHeight], theme: document.body.classList.contains('tier-fruity-bg'),
            elements: ids.map(id => {const e=document.getElementById(id), r=e.getBoundingClientRect(); return {id,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}),
            seat: getComputedStyle(document.querySelector('.seat:not(.turn) .name-chips')).backgroundImage,
            table: getComputedStyle(document.getElementById('poker_table')).backgroundImage };
        })()`);
        metrics.push({ width, height, theme, ...info });
        check(`${width}x${height}/${theme}: all card/action zones stay inside safe viewport`, info.elements.every(r => r.x >= -1 && r.right <= width + 1 && r.y >= -1 && r.bottom <= height + 1));
        check(`${width}x${height}/${theme}: existing table image loads`, await evaluate("new Promise(resolve => { const img = new Image(); img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = getComputedStyle(document.getElementById('poker_table')).backgroundImage.slice(5,-2); })"));
        await screenshot(`${width}-${height}-${theme}`);
        const calculatorError = await evaluate("(() => { try { show_custom_raise(); return null; } catch (error) { return error.message; } })()");
        if (calculatorError) {
          // This pre-existing desktop helper is outside Step 1. Verify the same
          // error with the new stylesheet disabled, and record it explicitly.
          const baselineError = await evaluate("(() => { const sheet=[...document.styleSheets].find(s=>s.href?.includes('imdcx-table.css')); sheet.disabled=true; try { show_custom_raise(); return null; } catch(error) { return error.message; } finally { sheet.disabled=false; } })()");
          assert.equal(calculatorError, baselineError);
          existingLimitations.add(calculatorError);
        }
        await wait('isCalcOpen()');
        check(`${width}x${height}/${theme}: calculator styling unchanged`, await evaluate(`(() => {
          const sheet = [...document.styleSheets].find(s => s.href?.includes('imdcx-table.css'));
          const props = ['color','backgroundImage','backgroundColor','fontSize','fontFamily','padding','borderRadius','boxShadow','width','height','transform'];
          const snapshot = () => [...document.querySelectorAll('.raise-window, .raise-window *')].map(el => {const c=getComputedStyle(el); return props.map(p=>c[p]);});
          const after = JSON.stringify(snapshot()); sheet.disabled = true; const before = JSON.stringify(snapshot()); sheet.disabled = false;
          return before === after;
        })()`));
        await evaluate('calcClose()');
      }
      // Exercise live calls after both theme switches; capture the existing flop renderer.
      for (let n = 0; n < 12; n++) {
        if (await evaluate("currentGameState.phase !== 'preflop'")) break;
        const revision = await evaluate('currentGameState.demoRevision');
        await evaluate('human_check_call()');
        await wait(`currentGameState.demoRevision > ${revision}`);
      }
      check(`${width}x${height}: existing betting controls reach flop`, await evaluate("currentGameState.phase === 'flop'"));
      await delay(2500);
      await screenshot(`${width}-${height}-flop`);
    }
    check('No browser exceptions', errors.length === 0);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, metrics, errors, existingLimitations: [...existingLimitations] }, null, 2));
    return;
  }
  for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/poker.html` });
    await wait("!!document.getElementById('manual-demo-btn')");
    await evaluate("document.getElementById('manual-demo-btn').click()");
    await wait("document.body.dataset.imdcxScreen === 'demo-selection'");
    check(`${width}: both demo choices appear`, await evaluate("document.querySelectorAll('.demo-selection [data-seats]').length === 2"));
    await delay(500);
    await screenshot(`selection-${width}`);
    for (const seats of [2, 10]) {
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/poker.html?demo=${seats}` });
      await wait(`typeof currentGameState !== 'undefined' && currentGameState?.demo && currentGameState.players.length === ${seats}`);
      await evaluate('window.__imdcxFinishPortalIntro?.()');
      await delay(800);
      check(`${width}/${seats}: actor owns existing controls`, await evaluate('mySeatIndex === currentGameState.current_bettor_index && currentGameState.players[mySeatIndex].id === mySocketId'));
      await evaluate("document.querySelector('[data-all]').click()");
      check(`${width}/${seats}: all hole cards inspectable`, await evaluate(`document.querySelectorAll('[data-cards] span').length === ${seats}`));
      await screenshot(`table-${seats}-${width}`);
      const first = await evaluate('currentGameState.current_bettor_index');
      await evaluate("document.getElementById('call-button').click()");
      await wait(`currentGameState.current_bettor_index !== ${first}`);
      check(`${width}/${seats}: call passes control to the next seat`, await evaluate('mySeatIndex === currentGameState.current_bettor_index'));
      await evaluate("document.getElementById('custom-raise').click()");
      await wait('isCalcOpen()');
      check(`${width}/${seats}: existing raise controls open`, await evaluate('isCalcOpen()'));
      for (let n = 0; n < seats; n++) {
        const revision = await evaluate('currentGameState.demoRevision');
        if (n > 0) { await evaluate("document.getElementById('custom-raise').click()"); await wait('isCalcOpen()'); }
        await evaluate("document.querySelector('.calc-allin-btn').click()");
        await evaluate("document.querySelector('[onclick=\"calcConfirm()\"]').click()");
        await wait(`currentGameState.demoRevision > ${revision}`);
      }
      await wait('currentGameState.roundEvaluated');
      check(`${width}/${seats}: manual all-ins reach the existing showdown`, await evaluate('currentGameState.players.some(p => p.status === "WINNER") && currentGameState.players.reduce((sum, p) => sum + p.bankroll, 0) + currentGameState.pot === currentGameState.players.length * 20000'));
      await screenshot(`showdown-${seats}-${width}`);
      await evaluate("document.querySelector('[data-restart]').click()");
      await wait('currentGameState.demoRevision === 0 && currentGameState.roundNumber === 1');
      check(`${width}/${seats}: restart restores all stacks`, await evaluate('currentGameState.players.every(p => p.bankroll + p.subtotal_bet === 20000)'));
      const room = await evaluate('currentGameState.demoRoomID');
      await evaluate("document.querySelector('[data-next]').click()");
      await wait(`currentGameState.demoRoomID !== ${JSON.stringify(room)}`);
      check(`${width}/${seats}: new hand advances normally`, await evaluate('currentGameState.roundNumber === 2'));
      await evaluate("document.querySelector('[data-quit]').click()");
      await wait("!!document.getElementById('manual-demo-btn')");
      check(`${width}/${seats}: quit restores home`, await evaluate("!document.getElementById('manual-demo-tools')"));
    }
  }
  check('No browser exceptions', errors.length === 0);
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  ws?.close();
  for (const child of [chrome, server]) {
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
  }
  // Remove the junction first so recursive cleanup never walks the source app.
  const link = path.join(directory, 'poker-app');
  if (fs.existsSync(link)) fs.unlinkSync(link);
  const resolved = fs.realpathSync(directory);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('imdcx-demo-browser-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
