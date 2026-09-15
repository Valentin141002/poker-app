/* Invoked by verify-manual-demo.cjs --popups, on its isolated server/databases. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ cdp, evaluate, wait, screenshot, check, delay, port, output }) => {
  const metrics = [];
  const click = async selector => {
    const point = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'end'});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,reachable:el.contains(document.elementFromPoint(x,y))};})()`);
    assert.ok(point.reachable, `Pointer can reach ${selector}: ${JSON.stringify(point)}`);
    await cdp('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
    await cdp('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
  };
  const selectedWidth = Number(process.argv.find(arg => arg.startsWith('--viewport='))?.split('=')[1]);
  const key = async (key, extra = {}) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra });
    await delay(80);
  };
  const inspect = async (id, label, width, height) => {
    const data = await evaluate(`(() => {
      const root=document.getElementById('${id}'), surface=root.querySelector('.imdcx-popup-surface');
      const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const visible=el=>!!el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
      return {box:rect(surface), overflow:surface.scrollWidth-surface.clientWidth,
        scrollable:surface.scrollHeight>surface.clientHeight, color:getComputedStyle(surface).color,
        role:surface.getAttribute('role'), close:rect(surface.querySelector('.popup-close,.rules-close,.odds-close,.stats-close')),
        buttons:[...surface.querySelectorAll('button:not(.calc-move-btn)')].filter(visible).map(el=>({text:el.textContent.trim(),...rect(el)}))};
    })()`);
    metrics.push({ label, ...data });
    await screenshot(label);
    assert.ok(data.box.x >= -1 && data.box.right <= width + 1 && data.box.y >= -1 && data.box.bottom <= height + 1, `${label}: fits viewport ${JSON.stringify(data.box)}`);
    assert.ok(data.overflow <= 2, `${label}: no horizontal overflow: ${data.overflow}`);
    assert.equal(data.role, 'dialog');
    assert.ok(data.close.width >= 44 && data.close.height >= 44, `${label}: accessible close`);
    assert.ok(data.buttons.every(b => b.height >= 43.9), `${label}: touch heights: ${JSON.stringify(data.buttons.filter(b=>b.height<43.9))}`);
    check(`${label}: visible, readable controls and responsive surface`, true);
  };
  for (const [width,height,mobile] of [[1440,900,false],[390,844,true],[320,740,true],[844,390,true]].filter(([w])=>!selectedWidth||selectedWidth===w)) {
    await cdp('Emulation.setDeviceMetricsOverride', { width,height,mobile,deviceScaleFactor:1 });
    await cdp('Page.navigate', { url:`http://127.0.0.1:${port}/poker.html?demo=2` });
    await wait("typeof currentGameState !== 'undefined' && currentGameState?.demo && !!window.IMDCXPopups");
    await evaluate('window.__imdcxFinishPortalIntro?.()');
    await delay(5500);
    for (const theme of ['forceDark','forceFruity']) {
      await evaluate(`backgroundThemeOverride='${theme}';applyTierBackgroundTheme(currentGameState)`);
      await delay(300);
      const label=`${width}-${height}-${theme}`;
      for (const [id,button] of [['rules-modal','rules-help-btn'],['odds-modal','odds-help-btn'],['sos-modal','sos-help-btn'],['stats-modal','stats-help-btn']]) {
        await evaluate(`document.getElementById('${button}').focus();document.getElementById('${button}').click()`);
        await wait(`document.getElementById('${id}').classList.contains('open')`);
        if (id === 'stats-modal') await wait("!!document.querySelector('#stats-modal .me-profile-card')");
        await delay(300);
        await inspect(id,`${label}-${id}`,width,height);
        // Long content must remain reachable; close remains visible when scrolled.
        await evaluate(`document.querySelector('#${id} .imdcx-popup-surface').scrollTop=99999`);
        const reachable = await evaluate(`(() => {const el=document.querySelector('#${id} .rules-close,#${id} .odds-close,#${id} .stats-close');const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
        check(`${label}/${id}: close stays reachable after scrolling`,reachable);
        await key('Escape');
        await wait(`!document.getElementById('${id}').classList.contains('open')`);
        check(`${label}/${id}: focus returns to opener`, await evaluate(`document.activeElement.id==='${button}'`));
      }
      await evaluate("document.getElementById('custom-raise').focus();document.getElementById('custom-raise').click()");
      await wait('isCalcOpen()');
      await delay(150);
      await inspect('modal-box',`${label}-raise`,width,height);
      const amount=await evaluate('getCalcVal()');
      await click('.chip-50');
      assert.equal(await evaluate('getCalcVal()'), amount+50);
      await click('[onclick="calcClear()"]');
      assert.equal(await evaluate('getCalcVal()'), amount);
      await click('.calc-allin-btn');
      assert.equal(await evaluate('getCalcVal()'),await evaluate('currentGameState.players[mySeatIndex].bankroll+currentGameState.players[mySeatIndex].subtotal_bet'));
      for (const fraction of [.25,.5,.75,1]) {
        const desired=await evaluate(`(() => {const s=document.getElementById('calc-slider');const val=Math.round(Number(s.min)+(Number(s.max)-Number(s.min))*${fraction});s.value=val;s.dispatchEvent(new Event('input',{bubbles:true}));return val;})()`);
        assert.equal(await evaluate('getCalcVal()'),desired);
      }
      check(`${label}: chips, CLEAR, ALL-IN and slider retain betting amounts`,true);
      await evaluate('calcClear()');
      // Switching skin while open keeps the very same form and value.
      await evaluate("window.__popupNode=document.querySelector('.raise-window');window.__popupColor=getComputedStyle(__popupNode).color");
      await evaluate(`backgroundThemeOverride='${theme==='forceDark'?'forceFruity':'forceDark'}';applyTierBackgroundTheme(currentGameState)`);
      check(`${label}: live skin switch preserves form and amount`,await evaluate(`document.querySelector('.raise-window')===__popupNode && getCalcVal()===${amount} && getComputedStyle(__popupNode).color!==__popupColor`));
      await evaluate(`backgroundThemeOverride='${theme}';applyTierBackgroundTheme(currentGameState)`);
      // Nested dialog: Escape dismisses only probabilities, calculator keeps its amount.
      await evaluate("document.getElementById('calc-proba-btn').focus();document.getElementById('calc-proba-btn').click()");
      await wait("document.getElementById('odds-modal').classList.contains('open')");
      check(`${label}: nested odds above raise`,await evaluate("Number(getComputedStyle(document.getElementById('odds-modal')).zIndex)>Number(getComputedStyle(document.getElementById('modal-box')).zIndex)"));
      await key('Escape');
      check(`${label}: nested close preserves calculator and restores focus`,await evaluate(`isCalcOpen()&&getCalcVal()===${amount}&&document.activeElement.id==='calc-proba-btn'`));
      await evaluate("document.querySelector('.popup-close').focus()");
      await key('Tab',{modifiers:8});
      check(`${label}: Tab focus stays in dialog`,await evaluate("document.querySelector('.raise-window').contains(document.activeElement)"));
      await evaluate("document.getElementById('calc-opacity-btn').click()");
      await evaluate("(() => {const opacity=document.getElementById('calc-opacity-range');opacity.value=80;opacity.dispatchEvent(new Event('input',{bubbles:true}));})()");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.raise-window')).opacity"),'0.8');
      await evaluate("document.getElementById('calc-opacity-btn').click()");
      await key('Escape');
      check(`${label}: calculator closes`,await evaluate('!isCalcOpen()'));
      // Use only a temporary client-side fixture to cover existing PRO controls.
      await evaluate("window.__savedSub=currentGameState.players[mySeatIndex].subscription;currentGameState.players[mySeatIndex].subscription='pro';show_custom_raise()");
      await inspect('modal-box',`${label}-raise-pro`,width,height);
      await click('[onclick="calcAddDigit(7)"]');
      assert.equal(await evaluate('getCalcVal()'),7);
      await click('[onclick="calcRaisePrevFactor(2)"]');
      assert.equal(await evaluate('getCalcVal()'),amount*2);
      await evaluate('calcClose();currentGameState.players[mySeatIndex].subscription=__savedSub');
      await delay(80);
      for (const [id,open] of [['time-rules-modal','showTimeRules'],['add30-rules-modal','showAdd30Rules'],['add30-confirm-modal','showAdd30Confirm'],['hide-rules-modal','showHideRules'],['show-rules-modal','showShowRules'],['sos-chat-modal','openSosChat']]) {
        await evaluate(`document.getElementById('rules-help-btn').focus();${open}()`);
        await delay(260);
        await inspect(id,`${label}-${id}`,width,height);
        await key('Escape');
        check(`${label}/${id}: closes without any request or message`,await evaluate(`!document.getElementById('${id}').classList.contains('open')`));
      }
      // Existing movement controls remain usable; resizing re-centers the panel.
      await evaluate('show_custom_raise()');
      await click('.calc-move-btn.right');
      check(`${label}: movement stays inside viewport`,await evaluate("(() => {const r=document.querySelector('.raise-window').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1;})()"));
      await cdp('Emulation.setDeviceMetricsOverride', { width:width-10,height,mobile,deviceScaleFactor:1 });
      await delay(100);
      await cdp('Emulation.setDeviceMetricsOverride', { width,height,mobile,deviceScaleFactor:1 });
      await delay(100);
      check(`${label}: resize reflows calculator`,await evaluate("document.querySelector('.raise-window').style.position===''"));
      await evaluate('calcClose()');
    }
    // Submit one actual valid raise through the unchanged controls and real engine.
    const state=await evaluate('({revision:currentGameState.demoRevision,actor:mySeatIndex})');
    await evaluate("show_custom_raise();document.querySelector('.chip-50').click();document.querySelector('[onclick=\"calcConfirm()\"]').click()");
    await wait(`currentGameState.demoRevision>${state.revision}`);
    check(`${width}: BET reaches engine and hands control to next demo player`,await evaluate(`mySeatIndex!==${state.actor}&&!isCalcOpen()`));
  }
  fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));
};
