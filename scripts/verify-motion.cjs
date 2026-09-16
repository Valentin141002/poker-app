/* Browser scenarios use the harness's isolated server and actual poker actions. */
'use strict';
const assert=require('node:assert/strict');
module.exports=async({cdp,evaluate,wait,screenshot,check,delay,port})=>{
  const selected=Number(process.argv.find(arg=>arg.startsWith('--viewport='))?.split('=')[1]);
  const act=async expression=>{
    const rev=await evaluate('currentGameState.demoRevision');
    await evaluate(expression);
    await wait(`currentGameState.demoRevision>${rev}`);
    await delay(90);
  };
  const probe=`(() => {
    window.__motionEvents=[];window.__peakEffects=0;window.__longestEffect=0;
    window.__motionFaceMatches=(el,code)=>{
      if(!el||!code)return false;
      const expected=document.createElement('div');
      expected.style.cssText='position:fixed;left:-9999px;width:120px;height:145px';
      document.body.appendChild(expected);internal_setCard(expected,code,false);
      const matches=getComputedStyle(el).backgroundImage===getComputedStyle(expected).backgroundImage;
      expected.remove();return matches;
    };
    new MutationObserver(records=>{
      for(const record of records) for(const el of record.addedNodes) {
        if(el.nodeType!==1)continue;
        if(el.matches('.motion-action'))__motionEvents.push(el.textContent);
        if(el.matches('.motion-vortex'))__motionEvents.push('NEW HAND');
        if(el.matches('.motion-card-flight'))__motionEvents.push('DEAL');
      }
      __peakEffects=Math.max(__peakEffects,document.querySelectorAll('#imdcx-motion-layer > *').length);
      document.querySelectorAll('#imdcx-motion-layer > *').forEach(el=>el.getAnimations().forEach(a=>{
        __longestEffect=Math.max(__longestEffect,a.effect.getComputedTiming().endTime);
      }));
    }).observe(document.body,{childList:true,subtree:true});
  })()`;
  for(const [width,height,mobile] of [[1440,900,false],[390,844,true],[320,740,true],[844,390,true]].filter(([w])=>!selected||w===selected)){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
    for(const theme of ['forceDark','forceFruity']){
      const label=`${width}-${height}-${theme}`;
      await cdp('Page.navigate',{url:`http://127.0.0.1:${port}/poker.html?demo=2`});
      await wait("typeof currentGameState!=='undefined'&&currentGameState?.demo&&!!window.IMDCXMotion");
      await evaluate(`window.__imdcxFinishPortalIntro?.();backgroundThemeOverride='${theme}';applyTierBackgroundTheme(currentGameState)`);
      await delay(5500);await evaluate(probe);
      // Confirmed decisions, including a call that immediately changes street.
      await act("show_custom_raise();document.querySelector('[onclick=\"calcConfirm()\"]').click()");
      await act('human_check_call()');
      await wait("currentGameState.phase==='flop'");
      await screenshot(`${label}-flop-in-motion`);
      await delay(650);
      check(`${label}: flop faces match dealt cards after short flips`,await evaluate("['flop1','flop2','flop3'].every((id,i)=>document.getElementById(id).dataset.cardCode===currentGameState.board[i]&&__motionFaceMatches(document.getElementById(id),currentGameState.board[i])&&!document.getElementById(id).classList.contains('motion-flipping'))"));
      await act('human_check_call()');
      await act("show_custom_raise();document.querySelector('[onclick=\"calcConfirm()\"]').click()");
      await act("show_custom_raise();document.querySelector('.calc-allin-btn').click();document.querySelector('[onclick=\"calcConfirm()\"]').click()");
      await screenshot(`${label}-allin`);
      await act('human_fold()');
      const events=await evaluate('__motionEvents');
      for(const action of ['RAISE','CALL','CHECK','BET','ALL-IN','FOLD'])check(`${label}: ${action} has short visible feedback`,events.includes(action));
      await delay(1100);
      // Folding can also trigger the winner celebration (up to 1500 ms).
      await wait("!document.querySelector('#imdcx-motion-layer > *')");
      check(`${label}: transient action effects finish`,await evaluate("!document.querySelector('#imdcx-motion-layer > *')"));
      // Restart during a board flip. Old callbacks must not bring old faces back.
      await evaluate("document.querySelector('[data-restart]').click()");await wait('currentGameState.demoRevision===0');await delay(750);
      await act('human_check_call()');await act('human_check_call()');
      const oldRoom=await evaluate('currentGameState.demoRoomID');
      await evaluate("document.querySelector('[data-next]').click()");
      await wait(`currentGameState.demoRoomID!==${JSON.stringify(oldRoom)}`);
      await delay(800);
      // Await the browser's completion event, which may be delivered a frame late
      // under headless load. Actual effect durations are independently capped below.
      await wait("!document.querySelector('#imdcx-motion-layer > *')");
      // The fresh private hand opens after distribution; its valid flip is independent
      // of the canceled previous board flip and can finish after the effect layer.
      await wait("!document.querySelector('.motion-flipping')&&[...document.querySelectorAll('.my-seat .holecards .card')].every((c,n)=>__motionFaceMatches(c,n?currentGameState.players[mySeatIndex].cardb:currentGameState.players[mySeatIndex].carda))");
      const resetInfo=await evaluate("({phase:currentGameState.phase,board:['flop1','flop2','flop3','turn','river'].map(id=>({id,back:document.getElementById(id).dataset.hasBack,face:document.getElementById(id).dataset.cardCode})),flips:[...document.querySelectorAll('.motion-flipping')].map(el=>el.className),fx:[...document.querySelectorAll('#imdcx-motion-layer > *')].map(el=>({name:el.className,animations:el.getAnimations().map(a=>({current:a.currentTime,timing:a.effect.getTiming(),state:a.playState}))}))})");
      assert.ok(resetInfo.phase==='preflop'&&resetInfo.board.every(c=>c.back==='1')&&!resetInfo.flips.length&&!resetInfo.fx.length,`${label}: reset ${JSON.stringify(resetInfo)}`);
      check(`${label}: new hand clears flips and deals without leftover seat backs`,true);
      check(`${label}: new-hand vortex and distribution are present`,await evaluate("__motionEvents.includes('NEW HAND')&&__motionEvents.includes('DEAL')"));
      // Real showdown / SHOW; preserve existing authoritative reveal decisions.
      for(let i=0;i<12;i++){if(await evaluate("currentGameState.phase==='reveal'"))break;await act('human_check_call()');}
      await wait("currentGameState.phase==='reveal'&&Number.isInteger(currentGameState.revealSeq?.activeSeat)");
      for(let i=0;i<2;i++){
        if(await evaluate('currentGameState.revealSeq.done'))break;
        await wait("document.querySelector('.reveal-card-btn.show.reveal-overlay')?.getAttribute('aria-disabled')==='false'");
        const actor=await evaluate('currentGameState.revealSeq.activeSeat');
        await evaluate("document.querySelector('.reveal-card-btn.show.reveal-overlay').click()");
        await wait(`currentGameState.players[${actor}].revealStatus==='show'`);
        await delay(70);await screenshot(`${label}-show-${i}`);await delay(550);
      }
      await wait('currentGameState.roundEvaluated');
      await wait("currentGameState.players.filter(p=>p.status==='WINNER').length>0&&currentGameState.players.every((p,i)=>p.status!=='WINNER'||document.getElementById('seat'+i).classList.contains('motion-winner'))");
      await wait("!document.querySelector('#imdcx-motion-layer > *')");
      check(`${label}: authoritative winner is highlighted`,await evaluate("currentGameState.players.every((p,i)=>p.status!=='WINNER'||document.getElementById('seat'+i).classList.contains('motion-winner'))"));
      check(`${label}: winner faces remain correctly painted`,await evaluate("currentGameState.players.filter(p=>p.status==='WINNER').length>0&&currentGameState.players.every((p,i)=>p.status!=='WINNER'||[...document.querySelectorAll('#seat'+i+' .card')].every((c,n)=>c.dataset.cardCode===(n?p.cardb:p.carda)&&__motionFaceMatches(c,n?p.cardb:p.carda)&&c.classList.contains('motion-winning-card')))"));
      await screenshot(`${label}-winner`);
      check(`${label}: bounded particle count, short durations and no lingering effects`,await evaluate("__peakEffects<=48&&__longestEffect<=1600&&!document.querySelector('#imdcx-motion-layer > *')"));
      // Accessibility: flips settle synchronously and decorative flights stop.
      await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await evaluate("document.querySelector('[data-next]').click()");await wait("currentGameState.phase==='preflop'");
      await act('human_check_call()');await act('human_check_call()');await wait("currentGameState.phase==='flop'");
      check(`${label}: reduced motion keeps correct cards and avoids flights`,await evaluate("!document.querySelector('.motion-flipping')&&!document.querySelector('#imdcx-motion-layer > *')&&['flop1','flop2','flop3'].every((id,i)=>document.getElementById(id).dataset.cardCode===currentGameState.board[i])"));
      await cdp('Emulation.setEmulatedMedia',{features:[]});
    }
  }
};
