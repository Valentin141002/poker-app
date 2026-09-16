/* Real server snapshots and real controls: no mocked cards, winners, or payouts. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ cdp, evaluate, wait, screenshot, check, delay, port, output }) => {
  const selected = Number(process.argv.find(arg => arg.startsWith('--viewport='))?.split('=')[1]);
  const metrics = [];
  const intersect = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  const inside = (r, width, height) => r.x >= -1.5 && r.y >= -1.5 && r.right <= width + 1.5 && r.bottom <= height + 1.5;
  const act = async expression => {
    const revision = await evaluate('currentGameState.demoRevision');
    await evaluate(expression);
    await wait(`currentGameState.demoRevision > ${revision}`);
    await delay(110);
  };
  const nextHand = async () => {
    const room = await evaluate('currentGameState.demoRoomID');
    await evaluate("document.querySelector('[data-next]').click()");
    await wait(`currentGameState.demoRoomID !== ${JSON.stringify(room)} && currentGameState.phase === 'preflop'`);
  };
  const probe = `(() => {
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height };
    };
    const visible = el => {
      if (!el || el.getBoundingClientRect().width < 1 || el.getBoundingClientRect().height < 1) return false;
      for (let node=el;node;node=node.parentElement) {
        const css=getComputedStyle(node);
        if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;
      }
      return true;
    };
    const expected = code => {
      if(!code||code==='blinded')return null;
      const el=document.createElement('div');
      el.style.cssText='position:fixed;left:-9999px;width:120px;height:145px';
      document.body.appendChild(el);internal_setCard(el,code,false);
      const image=getComputedStyle(el).backgroundImage;el.remove();return image;
    };
    const card = (el,code) => {
      const css=getComputedStyle(el);
      return {rect:rect(el),code,dataset:el.dataset.cardCode,back:el.dataset.hasBack==='1',
        face:!!code&&css.backgroundImage===expected(code),visible:visible(el),
        image:css.backgroundImage.slice(0,180),classes:el.className,rotate:css.rotate,transform:css.transform};
    };
    window.__neonEvents=[];window.__neonPeak=0;window.__neonLongest=0;
    const center=el=>{if(!el)return null;const r=rect(el);return{x:r.x+r.width/2,y:r.y+r.height/2};};
    new MutationObserver(records=>{
      for(const record of records)for(const el of record.addedNodes){
        if(el.nodeType!==1||el.parentElement?.id!=='imdcx-motion-layer')continue;
        const anim=el.getAnimations()[0];
        const frames=anim?.effect?.getKeyframes()||[];
        const move=String(frames.at(-1)?.transform||'').match(/translate3d\\(([-\\d.]+)px,\\s*([-\\d.]+)px/);
        const from={x:parseFloat(el.style.left)+parseFloat(el.style.width)/2,y:parseFloat(el.style.top)+parseFloat(el.style.height)/2};
        __neonEvents.push({classes:el.className,text:el.textContent,from,
          to:move?{x:from.x+Number(move[1]),y:from.y+Number(move[2])}:null,
          pot:center(document.getElementById('pot')),
          seats:[...document.querySelectorAll('#poker_table .seat .name-chips')].map(center)});
      }
      const effects=[...document.querySelectorAll('#imdcx-motion-layer > *')];
      __neonPeak=Math.max(__neonPeak,effects.length);
      effects.forEach(el=>el.getAnimations().forEach(a=>{
        __neonLongest=Math.max(__neonLongest,a.effect.getComputedTiming().endTime);
      }));
    }).observe(document.body,{childList:true,subtree:true});
    window.__neonReview=()=>({
      phase:currentGameState.phase,room:currentGameState.demoRoomID,revision:currentGameState.demoRevision,
      actor:mySeatIndex,active:currentGameState.current_bettor_index,
      board:[...document.querySelectorAll('#board > :is(#flop1,#flop2,#flop3,#turn,#river)')].map((el,i)=>card(el,currentGameState.board[i])),
      boardCount:[...document.querySelectorAll('.boardcard')].filter(visible).length,
      streetLabels:[...document.querySelectorAll('#poker_table *')].filter(el=>!el.children.length&&visible(el)&&/^(flop|turn|river)$/i.test(el.textContent.trim())).map(el=>el.textContent),
      controls:['fold-button','call-button','custom-raise','odds-help-btn','sos-help-btn'].map(id=>({id,rect:rect(document.getElementById(id))})),
      players:currentGameState.players.map((p,i)=>{
        const seat=document.getElementById('seat'+i);
        return {index:i,status:p.status,reveal:p.revealStatus,own:seat.classList.contains('my-seat'),
          classes:seat.className,panel:rect(seat.querySelector('.name-chips')),
          cards:[...seat.querySelectorAll('.holecards .card')].map((el,n)=>card(el,n?p.cardb:p.carda))};
      })
    });
  })()`;
  const settled = () => wait("__neonReview().players.find(p=>p.own)?.cards.every(c=>c.visible&&c.face&&c.dataset===c.code)&&!document.querySelector('.motion-flipping')");
  const assertBetting = (info, label) => {
    const own = info.players.find(p => p.own);
    assert.ok(own?.cards.length === 2 && own.cards.every(c => c.visible && c.face && c.dataset === c.code), `${label}: private hand agrees with server cards`);
    assert.ok(info.players.filter(p => !p.own).every(p => p.cards.every(c => !c.visible)), `${label}: no stray opponent cards: ${JSON.stringify(info.players.filter(p => !p.own && p.cards.some(c => c.visible)))}`);
    assert.ok(info.players[info.active]?.classes.split(' ').includes('turn'), `${label}: authoritative active player has turn highlight`);
  };
  const assertBoard = (info, width, height, label) => {
    const count = { preflop:0,flop:3,turn:4,river:5,reveal:5 }[info.phase];
    assert.equal(info.board.length, 5, `${label}: exactly five top community slots`);
    assert.equal(info.boardCount, 5, `${label}: no duplicate community cards in table center`);
    assert.equal(info.streetLabels.length, 0, `${label}: no visible street names`);
    const seatTop = Math.min(...info.players.map(p => p.panel.y));
    info.board.forEach((c, i) => {
      assert.ok(c.visible && inside(c.rect, width, height) && c.rect.bottom <= seatTop + 2, `${label}: community card ${i + 1} remains above seats and on screen: ${JSON.stringify(c.rect)}`);
      assert.ok(i < count ? c.face && !c.back && c.dataset === c.code : c.back && !c.face, `${label}: correct ${count}/5 reveal sequence: ${JSON.stringify(c)}`);
    });
  };
  const assertShown = (info, shown, hidden, width, height, label) => {
    for (const index of shown) {
      const p = info.players[index];
      assert.equal(p.reveal, 'show', `${label}: SHOW remains authoritative`);
      assert.ok(p.cards.length === 2 && p.cards.every(c => c.visible && c.face && c.dataset === c.code), `${label}: P${index + 1} shows actual faces: ${JSON.stringify(p)}`);
      assert.ok(intersect(p.cards[0].rect, p.cards[1].rect), `${label}: cards overlap as a seat stack`);
      const overlap = Math.min(p.cards[0].rect.right,p.cards[1].rect.right)-Math.max(p.cards[0].rect.x,p.cards[1].rect.x);
      assert.ok(overlap < Math.min(...p.cards.map(c=>c.rect.width))*.85, `${label}: both card ranks stay exposed`);
      for (const c of p.cards) {
        assert.ok(inside(c.rect,width,height), `${label}: shown card stays in viewport`);
        assert.ok(intersect(c.rect,p.panel), `${label}: shown card is anchored to its player panel`);
        assert.ok(info.board.every(b=>!intersect(c.rect,b.rect)), `${label}: shown card stays clear of community row`);
      }
    }
    for (const index of hidden) {
      const p=info.players[index];
      assert.equal(p.reveal,'hide',`${label}: HIDE remains authoritative`);
      assert.ok(p.cards.every(c=>!c.visible||!c.face),`${label}: HIDE keeps private faces concealed`);
    }
  };

  for (const [width,height,mobile] of [[1440,900,false],[390,844,true],[320,740,true]].filter(([w])=>!selected||w===selected)) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:mobile});
    for (const seats of [2,10]) {
      const label=`${width}x${height}/${seats}`;
      try {
        await cdp('Page.navigate',{url:`http://127.0.0.1:${port}/poker.html?demo=${seats}`});
        await wait(`typeof currentGameState !== 'undefined' && currentGameState?.demo && currentGameState.players.length === ${seats} && !!window.IMDCXMotion`);
        await evaluate("window.__imdcxFinishPortalIntro?.();backgroundThemeOverride='forceDark';applyTierBackgroundTheme(currentGameState);refreshResponsiveScaleAfterRender()");
        await evaluate(probe);
        await settled();
        await delay(1400);
        let info=await evaluate('__neonReview()');
        assertBetting(info,label);assertBoard(info,width,height,label);
        assert.ok(info.controls.every(c=>inside(c.rect,width,height)),`${label}: controls remain inside viewport`);
        check(`${label}: top JAQKT row, active seat and clean private hand layout`,true);
        await screenshot(`${width}-${seats}-preflop`);

        await nextHand();
        await wait("__neonEvents.some(e=>e.classes.includes('motion-seat-landing'))");
        await screenshot(`${width}-${seats}-dealing`);
        await settled();await delay(1400);
        assertBetting(await evaluate('__neonReview()'),`${label}/deal-complete`);
        const deal=await evaluate('__neonEvents');
        for(const name of ['motion-vortex-scene','motion-card-flight','motion-seat-landing','motion-energy-trail']){
          check(`${label}: new hand includes ${name}`,deal.some(e=>e.classes.includes(name)));
        }

        await act("show_custom_raise();document.querySelector('[onclick=\"calcConfirm()\"]').click()");
        await screenshot(`${width}-${seats}-raise`);
        const phases=new Set(['preflop']);
        for(let n=0;n<seats*5+6;n++){
          info=await evaluate('__neonReview()');
          if(info.phase==='reveal')break;
          await settled();info=await evaluate('__neonReview()');
          assertBetting(info,`${label}/${info.phase}/${n}`);
          if(!phases.has(info.phase)){
            assertBoard(info,width,height,`${label}/${info.phase}`);
            phases.add(info.phase);await screenshot(`${width}-${seats}-${info.phase}`);
          }
          await act('human_check_call()');
        }
        await wait("currentGameState.phase==='reveal'&&Number.isInteger(currentGameState.revealSeq?.activeSeat)");
        check(`${label}: board reveals exactly 0, 3, 4, then 5 cards in top slots`,['preflop','flop','turn','river'].every(p=>phases.has(p)));
        const events=await evaluate('__neonEvents');
        check(`${label}: bet/raise amount has seat feedback`,events.some(e=>e.classes.includes('motion-action')&&/BET|RAISE/.test(e.text))&&events.some(e=>e.classes.includes('motion-amount')));
        const distance=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y):Infinity;
        check(`${label}: bet chips travel from seat toward pot`,events.some(e=>e.classes.includes('motion-chip')&&!e.classes.includes('is-payout')&&distance(e.to,e.pot)<35&&e.seats.some(s=>distance(e.from,s)<35)));

        const shown=[],hidden=[];
        for(let n=0;n<seats;n++){
          if(await evaluate('currentGameState.revealSeq.done'))break;
          const actor=await evaluate('currentGameState.revealSeq.activeSeat');
          const hide=mobile&&n%2===1;
          const selector=`.reveal-card-btn.${hide?'hide':'show'}.reveal-overlay`;
          await wait(`document.querySelector('${selector}')?.getAttribute('aria-disabled')==='false'`);
          if(n===0){
            await evaluate(`window.__neonFlip=[];(() => { const until=performance.now()+650;const run=()=>{__neonFlip.push([...document.querySelectorAll('#seat${actor} .holecards .card')].map(el=>({rotate:getComputedStyle(el).rotate,transform:getComputedStyle(el).transform})));if(performance.now()<until)requestAnimationFrame(run);};requestAnimationFrame(run);})()`);
          }
          await evaluate(`document.querySelector('${selector}').click()`);
          await wait(`currentGameState.players[${actor}].revealStatus==='${hide?'hide':'show'}'`);
          (hide?hidden:shown).push(actor);
          await delay(650);
          info=await evaluate('__neonReview()');
          assertShown(info,shown,hidden,width,height,`${label}/choice${n}`);
          if(n===0){
            check(`${label}: SHOW flips back to face before retaining the stacked cards`,await evaluate("__neonFlip.some(frame=>frame.every(c=>(c.rotate.startsWith('y ')&&c.rotate!=='y 0deg')||c.transform.startsWith('matrix3d(')))"));
            await screenshot(`${width}-${seats}-show`);
          }
        }
        await wait('currentGameState.roundEvaluated&&currentGameState.revealSeq.done');
        await wait("__neonEvents.some(e=>e.classes.includes('motion-victory'))");
        await screenshot(`${width}-${seats}-victory`);
        await wait("__neonEvents.some(e=>e.classes.includes('motion-chip')&&e.classes.includes('is-payout'))");
        await delay(1800);
        info=await evaluate('__neonReview()');
        assertShown(info,shown,hidden,width,height,`${label}/victory`);
        const awarded=await evaluate('__neonEvents');
        check(`${label}: winner banner and highlighted winning seats agree with result`,awarded.some(e=>e.classes.includes('motion-victory')&&/YOU WIN|WINS|SPLIT POT/.test(e.text))&&info.players.filter(p=>p.status==='WINNER').every(p=>p.classes.includes('motion-winner')));
        check(`${label}: pot travels visibly to a winning seat`,awarded.some(e=>e.classes.includes('is-payout')&&distance(e.from,e.pot)<35&&info.players.filter(p=>p.status==='WINNER').some(p=>distance(e.to,e.seats[p.index])<35)));
        check(`${label}: bounded effects finish and public faces persist`,await evaluate('__neonPeak<=48&&__neonLongest<=1600&&!document.querySelector("#imdcx-motion-layer > *")'));
        await screenshot(`${width}-${seats}-settled-winner`);
        metrics.push({width,height,seats,shown,hidden,board:info.board,players:info.players,effectCount:awarded.length});

        // Reset while a real board flip is pending. No old callback may paint the new hand.
        await nextHand();await settled();
        for(let n=0;n<seats+2;n++){
          if(await evaluate("currentGameState.phase!=='preflop'"))break;
          await act('human_check_call()');
        }
        await wait("currentGameState.phase==='flop'");
        await nextHand();await settled();await delay(1500);
        info=await evaluate('__neonReview()');assertBetting(info,`${label}/reset`);assertBoard(info,width,height,`${label}/reset`);
        check(`${label}: new hand cancels old community flips and public faces`,info.players.every(p=>!p.reveal)&&await evaluate('!document.querySelector(".motion-flipping")'));

        if(seats===2){
          for(let n=0;n<12;n++){
            if(await evaluate("currentGameState.phase==='reveal'"))break;
            await act('human_check_call()');
          }
          await wait("document.querySelector('.reveal-card-btn.show.reveal-overlay')?.getAttribute('aria-disabled')==='false'");
          const showing=await evaluate('currentGameState.revealSeq.activeSeat');
          await evaluate("document.querySelector('.reveal-card-btn.show.reveal-overlay').click()");
          await wait(`currentGameState.players[${showing}].revealStatus==='show'`);
          await nextHand();await settled();await delay(1500);
          info=await evaluate('__neonReview()');assertBetting(info,`${label}/show-reset`);assertBoard(info,width,height,`${label}/show-reset`);
          check(`${label}: interrupted SHOW never repaints cards from the previous hand`,info.players.every(p=>!p.reveal)&&await evaluate('!document.querySelector(".motion-flipping")'));
        }

        // Accessibility covers real progression with decorative travel disabled.
        await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        await nextHand();await settled();
        for(let n=0;n<seats+2;n++){
          if(await evaluate("currentGameState.phase!=='preflop'"))break;
          await act('human_check_call()');
        }
        await wait("currentGameState.phase==='flop'");
        info=await evaluate('__neonReview()');assertBoard(info,width,height,`${label}/reduced`);
        check(`${label}: reduced motion preserves correct cards without flights`,await evaluate('!document.querySelector(".motion-flipping,.motion-card-flight,.motion-chip")'));
        await cdp('Emulation.setEmulatedMedia',{features:[]});
      } catch(error) {
        await screenshot(`${width}-${seats}-failure`).catch(()=>{});
        const state=await evaluate('window.__neonReview?.()').catch(()=>null);
        const effects=await evaluate('window.__neonEvents').catch(()=>null);
        fs.writeFileSync(path.join(output,`failure-${width}-${seats}.json`),JSON.stringify({label,message:error.message,state,effects},null,2));
        throw error;
      }
    }
  }
  return metrics;
};
