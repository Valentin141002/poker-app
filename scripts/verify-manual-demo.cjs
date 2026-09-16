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
const revealCards = process.argv.includes('--reveal-cards');
const popups = process.argv.includes('--popups');
const motion = process.argv.includes('--motion');
const neonReference = process.argv.includes('--neon-reference');
const liveReveal = process.argv.includes('--live-reveal');
const output = path.join(root, 'build', liveReveal ? 'live-reveal-review' : neonReference ? 'neon-reference-review' : motion ? 'motion-review' : popups ? 'popup-review' : revealCards ? 'demo-reveal-review' : tablePolish ? 'table-step1-review' : 'demo-review');
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
  if (neonReference || motion || liveReveal) {
    const helpers = { cdp, evaluate, wait, screenshot, check, delay, port, output };
    const scenario = liveReveal ? './verify-live-reveal.cjs' : neonReference ? './verify-neon-reference.cjs' : './verify-motion.cjs';
    const metrics = await require(scenario)(helpers);
    if (neonReference && !liveReveal) await require('./verify-live-reveal.cjs')(helpers);
    check('No browser exceptions', errors.length === 0);
    const width = process.argv.find(arg => arg.startsWith('--viewport='))?.split('=')[1];
    fs.writeFileSync(path.join(output, width ? `checks-${width}.json` : 'checks.json'), JSON.stringify({ checks, metrics, errors }, null, 2));
    return;
  }
  if (popups) {
    await require('./verify-popups.cjs')({ cdp, evaluate, wait, screenshot, check, delay, port, output });
    check('No browser exceptions', errors.length === 0);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    return;
  }
  if (revealCards) {
    const metrics = [];
    // The probe paints expected faces through the existing asset renderer. Actual
    // seat cards must independently agree with the server's dealt card codes and
    // computed faces; a .revealed class or a cardCode alone is insufficient.
    const installProbe = () => evaluate(`window.__cardReview = () => {
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
      };
      const visible = el => {
        if (!el || el.getBoundingClientRect().width < 1 || el.getBoundingClientRect().height < 1) return false;
        for (let node = el; node; node = node.parentElement) {
          const css = getComputedStyle(node);
          if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
        }
        return true;
      };
      const expectedFace = code => {
        if (!code || code === 'blinded') return null;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-9999px;width:120px;height:145px';
        document.body.appendChild(probe);
        internal_setCard(probe, code, false);
        const face = getComputedStyle(probe).backgroundImage;
        probe.remove(); return face;
      };
      return {
        phase:currentGameState.phase, actor:mySeatIndex, revision:currentGameState.demoRevision,
        theme:document.body.classList.contains('tier-fruity-bg') ? 'fruity' : 'neon',
        community:[...document.querySelectorAll('#flop1,#flop2,#flop3,#turn,#river')].map(rect),
        players:currentGameState.players.map((p,index) => {
          const seat=document.getElementById('seat'+index), panel=seat.querySelector('.name-chips');
          return { index, status:p.status, reveal:p.revealStatus, panel:rect(panel),
            own:seat.classList.contains('my-seat'), cards:[...seat.querySelectorAll('.holecards .card')].map((el,n) => {
              const code=n===0?p.carda:p.cardb, css=getComputedStyle(el);
              return { code, dataset:el.dataset.cardCode || null, visible:visible(el), rect:rect(el),
                faceMatches:css.backgroundImage===expectedFace(code),
                back:/cardbck|custom_[IM]|customI|customM/i.test(css.backgroundImage),
                image:css.backgroundImage.slice(0,220), classes:el.className };
            }) };
        })
      };
    }`);
    const within = (r, outer, tolerance = 1.5) => r.x >= outer.x - tolerance && r.y >= outer.y - tolerance && r.right <= outer.right + tolerance && r.bottom <= outer.bottom + tolerance;
    const intersects = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
    const assertBetting = (info, label) => {
      const opponents = info.players.filter(p => !p.own);
      assert.ok(opponents.every(p => p.cards.every(c => !c.visible)), `${label}: betting seats show no stray cards: ${JSON.stringify(opponents.filter(p => p.cards.some(c => c.visible)))}`);
      const own = info.players.find(p => p.own);
      assert.ok(own?.cards.length === 2 && own.cards.every(c => c.visible && c.dataset === c.code && c.faceMatches && !c.back), `${label}: current actor's proper hand area shows the dealt faces: ${JSON.stringify(own)}`);
    };
    const assertShown = (info, shown, hidden, width, height, label) => {
      for (const index of shown) {
        const p = info.players[index];
        assert.equal(p.reveal, 'show', `${label}: P${index + 1} remains publicly shown in server state`);
        assert.ok(p.cards.length === 2 && p.cards.every(c => c.visible && c.dataset === c.code && c.faceMatches && !c.back), `${label}: P${index + 1} has correct visible faces: ${JSON.stringify(p)}`);
        for (const c of p.cards) {
          assert.ok(within(c.rect, p.panel), `${label}: shown P${index + 1} card belongs inside its seat panel: ${JSON.stringify(p)}`);
          assert.ok(within(c.rect, { x:0,y:0,right:width,bottom:height }), `${label}: shown P${index + 1} cards stay in viewport`);
          assert.ok(info.community.every(board => !intersects(c.rect, board)), `${label}: shown P${index + 1} does not overlap community cards`);
        }
      }
      for (const index of hidden) {
        const p = info.players[index];
        assert.equal(p.reveal, 'hide', `${label}: P${index + 1} remains hidden in server state`);
        assert.ok(p.cards.every(c => !c.visible || !c.faceMatches), `${label}: HIDE never exposes P${index + 1}'s faces`);
      }
    };
    const selectedWidth = Number(process.argv.find(arg => arg.startsWith('--viewport='))?.split('=')[1]);
    for (const [width, height, mobile] of [[1440,900,false],[390,844,true],[320,740,true],[844,390,true]].filter(([w]) => !selectedWidth || w === selectedWidth)) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled:mobile });
      for (const seats of [2,10]) {
        const label = `${width}x${height}/${seats}`;
        try {
          await cdp('Page.navigate', { url:`http://127.0.0.1:${port}/poker.html?demo=${seats}` });
          await wait(`typeof currentGameState !== 'undefined' && currentGameState?.demo && currentGameState.players.length === ${seats}`);
          await evaluate('window.__imdcxFinishPortalIntro?.()');
          await installProbe();
          const firstTheme = width === 320 ? 'forceFruity' : 'forceDark';
          await evaluate(`backgroundThemeOverride='${firstTheme}'; applyTierBackgroundTheme(currentGameState); refreshResponsiveScaleAfterRender()`);
          await delay(5500);
          await wait("__cardReview().players.find(p => p.own)?.cards.every(c => c.visible && c.dataset === c.code && c.faceMatches && !c.classes.includes('my-card-3d-wrap'))");
          assertBetting(await evaluate('__cardReview()'), `${label}/preflop`);
          await screenshot(`${width}-${height}-${seats}-betting`);
          const phases = new Set();
          for (let action=0; action < seats * 5 + 4; action++) {
            const info = await evaluate('__cardReview()');
            if (info.phase === 'reveal') break;
            phases.add(info.phase);
            assertBetting(info, `${label}/${info.phase}/action${action}`);
            await evaluate('human_check_call()');
            await wait(`currentGameState.demoRevision > ${info.revision}`);
            // Let the existing render and layout settle between distinct turns.
            await delay(150);
          }
          await wait("currentGameState.phase === 'reveal' && Number.isInteger(currentGameState.revealSeq?.activeSeat)");
          check(`${label}: every betting street hides seat backs and preserves the active hand`, ['preflop','flop','turn','river'].every(phase => phases.has(phase)));
          const shown = [], hidden = [];
          for (let choice=0; choice < seats; choice++) {
            if (await evaluate('!!currentGameState.revealSeq?.done')) break;
            const actor = await evaluate('currentGameState.revealSeq.activeSeat');
            // Desktop covers all SHOW. Phones cover mixed SHOW/HIDE, including a
            // HIDE by the last heads-up actor without changing poker rules.
            const hide = mobile && choice % 2 === 1;
            const selector = `.reveal-card-btn.${hide?'hide':'show'}.reveal-overlay`;
            await wait(`document.querySelector('${selector}')?.getAttribute('aria-disabled') === 'false'`);
            if (choice === 0 && !mobile) {
              await evaluate(`(() => {
                window.__showFlipSamples = [];
                const cards = [...document.querySelectorAll('#seat${actor} .holecards .card')];
                const until = performance.now() + 1000;
                const sample = () => {
                  __showFlipSamples.push(cards.map(card => getComputedStyle(card).transform));
                  if (performance.now() < until) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              })()`);
            }
            await evaluate(`document.querySelector('${selector}').click()`);
            await wait(`currentGameState.players[${actor}].revealStatus === '${hide?'hide':'show'}'`);
            (hide ? hidden : shown).push(actor);
            await delay(900);
            if (choice === 0 && !mobile) {
              const frames = await evaluate('__showFlipSamples');
              check(`${label}: SHOW visibly rotates the existing card elements`, frames.some(frame => frame.every(value => value.startsWith('matrix3d('))));
            }
            const info = await evaluate('__cardReview()');
            assertShown(info, shown, hidden, width, height, `${label}/choice${choice}`);
            if (choice === 0) {
              check(`${label}: SHOW paints the correct faces after control moves to the next player`, info.actor !== actor);
              await screenshot(`${width}-${height}-${seats}-first-show`);
              const secondTheme = firstTheme === 'forceDark' ? 'forceFruity' : 'forceDark';
              await evaluate(`backgroundThemeOverride='${secondTheme}'; applyTierBackgroundTheme(currentGameState); refreshResponsiveScaleAfterRender()`);
              await delay(5500);
              assertShown(await evaluate('__cardReview()'), shown, hidden, width, height, `${label}/theme-change`);
              check(`${label}: switching theme preserves correct public faces and placement`, true);
            }
          }
          await wait('currentGameState.roundEvaluated && currentGameState.revealSeq?.done');
          const completed = await evaluate('__cardReview()');
          assertShown(completed, shown, hidden, width, height, `${label}/completed`);
          check(`${label}: complete SHOW/HIDE sequence preserves all public cards in their seats`, shown.length + hidden.length === seats);
          metrics.push({ width, height, seats, shown, hidden, completed });
          await screenshot(`${width}-${height}-${seats}-showdown`);
          // The original winner announcement runs five seconds after showdown.
          // A manually inspected demo must keep SHOW faces until Nouvelle main.
          await delay(mobile ? 6000 : 11000);
          assertShown(await evaluate('__cardReview()'), shown, hidden, width, height, `${label}/winner-announcement`);
          check(`${label}: public faces survive the delayed winner announcement`, true);
          const room = await evaluate('currentGameState.demoRoomID');
          await evaluate("document.querySelector('[data-next]').click()");
          await wait(`currentGameState.demoRoomID !== ${JSON.stringify(room)} && currentGameState.phase === 'preflop'`);
          await delay(5500);
          await wait("__cardReview().players.find(p => p.own)?.cards.every(c => c.visible && c.dataset === c.code && c.faceMatches && !c.classes.includes('my-card-3d-wrap'))");
          const fresh = await evaluate('__cardReview()');
          assertBetting(fresh, `${label}/fresh-hand`);
          check(`${label}: Nouvelle main clears old reveal statuses and old public faces`, fresh.players.every(p => !p.reveal));
          if (!mobile && seats === 2) {
            for (let action = 0; action < 14; action++) {
              if (await evaluate("currentGameState.phase === 'reveal'")) break;
              const revision = await evaluate('currentGameState.demoRevision');
              await evaluate('human_check_call()');
              await wait(`currentGameState.demoRevision > ${revision}`);
            }
            await wait("currentGameState.phase === 'reveal' && document.querySelector('.reveal-card-btn.show.reveal-overlay')?.getAttribute('aria-disabled') === 'false'");
            const actor = await evaluate('currentGameState.revealSeq.activeSeat');
            const previousRoom = await evaluate('currentGameState.demoRoomID');
            await evaluate("document.querySelector('.reveal-card-btn.show.reveal-overlay').click()");
            await wait(`currentGameState.players[${actor}].revealStatus === 'show'`);
            // Reset before the original 300/600 ms face-paint callbacks finish.
            await evaluate("document.querySelector('[data-next]').click()");
            await wait(`currentGameState.demoRoomID !== ${JSON.stringify(previousRoom)} && currentGameState.phase === 'preflop'`);
            await delay(5500);
            await wait("__cardReview().players.find(p => p.own)?.cards.every(c => c.visible && c.dataset === c.code && c.faceMatches && !c.classes.includes('my-card-3d-wrap'))");
            const rapidReset = await evaluate('__cardReview()');
            assertBetting(rapidReset, `${label}/rapid-reset`);
            check(`${label}: resetting during a SHOW flip cannot repaint the old hand`, rapidReset.players.every(p => !p.reveal));
          }
        } catch (error) {
          await screenshot(`${width}-${height}-${seats}-failure`).catch(() => {});
          const state = await evaluate('window.__cardReview?.()').catch(() => null);
          fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ label, message:error.message, state, checks, errors }, null, 2));
          throw error;
        }
      }
    }
    check('No browser exceptions', errors.length === 0);
    fs.writeFileSync(path.join(output, selectedWidth ? `checks-${selectedWidth}.json` : 'checks.json'), JSON.stringify({ checks, metrics, errors }, null, 2));
    return;
  }
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
        metrics.push({ width, height, ...info, theme });
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
