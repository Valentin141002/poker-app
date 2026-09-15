/* Phase 3: presentation only. The existing client owns cards, turns and payouts. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const jobs = new Map();
  const cardJobs = new WeakMap();
  const potValues = new WeakMap();
  const awarded = new Set();
  let epoch = 0, serial = 0, layer, frame = 0, turn = null, energyEpoch = -1;
  const EASE = 'cubic-bezier(.2,.75,.25,1)';
  const live = () => !reduce.matches && !document.hidden;
  const seat = index => document.getElementById(`seat${index}`);
  const panel = index => seat(index)?.querySelector('.name-chips');
  const center = el => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x:r.x+r.width/2, y:r.y+r.height/2, width:r.width, height:r.height } : null;
  };
  const potPoint = () => center(document.getElementById('pot'));
  const tableVisible = () => !!center(document.getElementById('poker_table'));
  function cancel(key) { jobs.get(key)?.(); }
  function animate(el, frames, duration = 380, { key = `fx-${++serial}`, delay = 0, done, remove = false } = {}) {
    cancel(key);
    if (!el || !live()) { done?.(); if (remove) el?.remove(); return; }
    const run = epoch;
    const animation = el.animate(frames, { duration, delay, easing:EASE, fill:'both' });
    const finish = () => {
      if (jobs.get(key) !== cleanup) return;
      jobs.delete(key); animation.onfinish = null; animation.cancel();
      if (run === epoch) done?.();
      if (remove) el.remove();
    };
    const cleanup = () => {
      jobs.delete(key); animation.onfinish = null; animation.cancel();
      if (remove) el.remove();
    };
    jobs.set(key, cleanup); animation.onfinish = finish;
  }
  function fx(className, point, width, height = width) {
    if (!live() || !point || !tableVisible()) return null;
    if (!layer?.isConnected) {
      layer = document.createElement('div'); layer.id = 'imdcx-motion-layer';
      layer.setAttribute('aria-hidden','true'); document.body.appendChild(layer);
    }
    // Hard cap for bursts of snapshots on a ten-seat table.
    if (layer.childElementCount >= 48) return null;
    const el = document.createElement('span'); el.className = className;
    Object.assign(el.style, { left:`${point.x-width/2}px`, top:`${point.y-height/2}px`, width:`${width}px`, height:`${height}px` });
    layer.appendChild(el); return el;
  }
  function burst(point, count = 6) {
    for (let i=0;i<count;i++) {
      const el = fx('motion-particle',point, i%2 ? 7 : 5); if (!el) break;
      const angle = i*Math.PI*2/count, distance = 24+(i%3)*10;
      animate(el,[{ transform:'translate3d(0,0,0) scale(.5)',opacity:0 },
        { transform:`translate3d(${Math.cos(angle)*distance*.4}px,${Math.sin(angle)*distance*.4}px,0) scale(1)`,opacity:.9,offset:.2 },
        { transform:`translate3d(${Math.cos(angle)*distance}px,${Math.sin(angle)*distance+8}px,0) rotate(${i*30}deg) scale(.3)`,opacity:0 }],460,{remove:true});
    }
  }
  function ring(point, size = 64, duration = 460) {
    const el=fx('motion-ring',point,size); if (!el) return;
    animate(el,[{transform:'scale(.5) rotate(-25deg)',opacity:0},
      {transform:'scale(.85) rotate(0deg)',opacity:.85,offset:.25},
      {transform:'scale(1.2) rotate(45deg)',opacity:0}],duration,{remove:true});
  }
  function clear({ settle = false } = {}) {
    // Finish visible card paints on resize/reduced motion; a new hand invalidates them.
    if (settle) document.querySelectorAll('.motion-flipping').forEach(el => cardJobs.get(el)?.settle());
    epoch++; cancelAnimationFrame(frame); frame = 0;
    [...jobs.values()].forEach(stop=>stop());
    document.querySelectorAll('.motion-flipping').forEach(el => { cardJobs.delete(el); el.classList.remove('motion-flipping'); });
    layer?.replaceChildren();
  }
  function prepare(prev, next) {
    const changed = !prev || prev.demoRoomID !== next.demoRoomID || prev.roundNumber !== next.roundNumber
      || (next.phase === 'preflop' && prev.phase !== 'preflop') || next.phase === 'waiting';
    if (!changed) return;
    clear(); awarded.clear(); turn=null;
    document.querySelectorAll('.motion-winner,.motion-winning-card').forEach(el=>el.classList.remove('motion-winner','motion-winning-card'));
  }
  function newHand(prev, next, callbacks = {}) {
    if (next?.phase !== 'preflop' || prev?.phase !== 'reveal') return false;
    // Reset painters synchronously; no visual effect blocks a server update.
    callbacks.onSwallow?.(); callbacks.onComplete?.();
    newHandEnergy();
    return true;
  }
  function newHandEnergy() {
    if (energyEpoch === epoch) return;
    energyEpoch = epoch;
    const point=potPoint(); if (!point) return;
    const el=fx('motion-ring motion-vortex',point,Math.min(210,innerWidth*.42));
    if (el) animate(el,[{transform:'scale(.9) rotate(-65deg)',opacity:0},
      {transform:'scale(1) rotate(0deg)',opacity:.9,offset:.22},
      {transform:'scale(.12) rotate(145deg)',opacity:0}],620,{remove:true});
    burst(point,8);
  }
  function chips(from, to, amount, payout = false) {
    if (!from || !to || amount <= 0 || !live()) return;
    const count = Math.min(5, Math.max(2,Math.ceil(Math.log10(amount+1))));
    for (let i=0;i<count;i++) {
      const el=fx('motion-chip',from,Math.min(23,Math.max(15,innerWidth*.045))); if (!el) break;
      const textures = typeof BET_CHIP_TEXTURES !== 'undefined' ? BET_CHIP_TEXTURES : [];
      if (textures.length) el.style.backgroundImage=`url("${textures[i%textures.length]}")`;
      const dx=to.x-from.x+(i%2 ? 3 : -3),dy=to.y-from.y;
      animate(el,[{transform:`translate3d(${i*2}px,0,0) rotate(-12deg) scale(.82)`,opacity:0},
        {transform:`translate3d(${dx*.38}px,${dy*.38-16}px,0) rotate(12deg) scale(1)`,opacity:1,offset:.35},
        {transform:`translate3d(${dx}px,${dy}px,0) rotate(28deg) scale(.8)`,opacity:0}],payout?560:440,
        {delay:i*35,remove:true,done:i===0?()=>ring(to,32,240):undefined});
    }
  }
  function action(index, label, delta = 0) {
    const target=panel(index), point=center(target); if (!point) return;
    const badgePoint={x:Math.max(45,Math.min(innerWidth-45,point.x)), y:Math.max(18,point.y-point.height/2-12)};
    const badge=fx(`motion-action motion-action-${label.toLowerCase().replace('-','')}`,badgePoint,86,25);
    if (badge) {
      badge.textContent=label;
      animate(badge,[{transform:'translateY(5px) scale(.9)',opacity:0},
        {transform:'translateY(0) scale(1)',opacity:1,offset:.2},
        {transform:'translateY(0) scale(1)',opacity:1,offset:.7},
        {transform:'translateY(-5px) scale(.96)',opacity:0}],650,{key:`action-${index}`,remove:true});
    }
    const tap = label==='CHECK';
    animate(target,tap ? [{translate:'0 0'},{translate:'0 2px',offset:.25},{translate:'0 0',offset:.5},{translate:'0 1px',offset:.7},{translate:'0 0'}]
      : [{scale:'1'},{scale:label==='ALL-IN'?'1.035':'1.018',offset:.35},{scale:'1'}],tap?300:380,{key:`seat-${index}`});
    if (label==='FOLD') ring(point,Math.min(point.width,56),300);
    else if (delta>0) chips(point,potPoint(),delta);
    if (label==='ALL-IN') burst(point,6);
  }
  function state(prev, next) {
    const active=next.phase==='reveal' ? next.revealSeq?.activeSeat : next.current_bettor_index;
    if (active !== turn) {
      const target=panel(active);
      if (target) animate(target,[{translate:'0 2px',scale:'.99'},{translate:'0 -2px',scale:'1.012',offset:.5},{translate:'0 0',scale:'1'}],360,{key:'turn'});
      turn=active;
    }
    if (!prev) return;
    const index=prev.current_bettor_index, before=prev.players?.[index], after=next.players?.[index];
    if (!before || !after || !['preflop','flop','turn','river'].includes(prev.phase)) return;
    const status=String(after.status || '').toUpperCase();
    const passed=prev.phase!==next.phase || next.current_bettor_index!==index;
    const delta=Math.max(0,Number(before.bankroll)-Number(after.bankroll),Number(after.subtotal_bet)-Number(before.subtotal_bet));
    if (!passed && status===before.status && delta===0) return;
    if (status==='FOLD' && before.status!=='FOLD') { action(index,'FOLD'); return; }
    if (delta>0) {
      const due=Math.max(0,Number(prev.current_bet||0)-Number(before.subtotal_bet||0));
      const label=status==='ALLIN' || after.bankroll===0 ? 'ALL-IN'
        : delta>due ? (Number(prev.current_bet)>0?'RAISE':'BET') : 'CALL';
      action(index,label,delta);
    } else if (passed && (status==='CHECK' || (['','CALL'].includes(status) && Number(prev.current_bet||0)===Number(before.subtotal_bet||0)))) action(index,'CHECK');
  }
  function deal() {
    const origin=potPoint(); if (!origin || !live()) return;
    newHandEnergy();
    const run=epoch;
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      frame=0; if (run!==epoch) return;
      const players=typeof currentGameState!=='undefined' ? currentGameState?.players : [];
      (players||[]).forEach((player,index)=>{
        if (!player || player.inactive || ['BUST','WAIT'].includes(player.status)) return;
        const own=index===mySeatIndex;
        if (own) {
          seat(index)?.querySelectorAll('.holecards .card').forEach((el,n)=>{
            const point=center(el); if (!point) return;
            const unit=el.offsetWidth ? point.width/el.offsetWidth : 1;
            const dx=(origin.x-point.x)/unit,dy=(origin.y-point.y)/unit;
            animate(el,[{translate:`${dx*.4}px ${dy*.4}px`,rotate:`${n?-8:8}deg`,scale:'.8',opacity:0},
              {translate:'0 -4px',rotate:'0deg',scale:'1.015',opacity:1,offset:.82},
              {translate:'0 0',rotate:'0deg',scale:'1',opacity:1}],420,{delay:n*65,key:`deal-${index}-${n}`});
          });
        } else {
          const point=center(panel(index)); if (!point) return;
          for (let n=0;n<2;n++) {
            const card=fx('motion-card-flight',origin,18,25); if (!card) break;
            card.style.backgroundImage=getThemeCardAssetCssUrl('cardback');
            const dx=point.x-origin.x+(n?4:-4),dy=point.y-origin.y;
            animate(card,[{transform:'translate3d(0,0,0) rotate(-10deg) scale(.6)',opacity:0},
              {transform:`translate3d(${dx*.6}px,${dy*.6-8}px,0) rotate(4deg) scale(1)`,opacity:.85,offset:.6},
              {transform:`translate3d(${dx}px,${dy}px,0) rotate(0deg) scale(.8)`,opacity:0}],360,{delay:Math.min(index*22+n*65,240),remove:true});
          }
        }
      });
    });
  }
  function flip(el, key, paint, { valid=()=>true, delay=0, instant=false } = {}) {
    if (!el) return;
    const previous=cardJobs.get(el);
    if (previous?.key===key && previous.epoch===epoch) { if (instant) previous.settle(); return; }
    previous?.cancel();
    const run=epoch, id=`card-${++serial}`;
    const current=()=>run===epoch && el.isConnected && valid();
    const cleanup=()=>{cancel(id);el.classList.remove('motion-flipping');if(cardJobs.get(el)===job)cardJobs.delete(el);};
    const settle=()=>{if(current())paint();cleanup();};
    const job={key,epoch:run,cancel:cleanup,settle}; cardJobs.set(el,job);
    if (!live() || instant) { settle(); return; }
    el.classList.add('motion-flipping');
    animate(el,[{rotate:'y 0deg',translate:'0 0'},{rotate:'y 90deg',translate:'0 -3px'}],150,
      {key:id,delay,done:()=>{
        if (!current()) {cleanup();return;}
        paint();
        animate(el,[{rotate:'y -90deg',translate:'0 -3px'}, {rotate:'y 0deg',translate:'0 -1px',offset:.8}, {rotate:'y 0deg',translate:'0 0'}],220,{key:id,done:cleanup});
      }});
  }
  function cancelCard(el) { cardJobs.get(el)?.cancel(); }
  function potChanged(el, amount) {
    const value=Number(amount); if (!el || !Number.isFinite(value)) return;
    const before=potValues.get(el); potValues.set(el,value);
    if (before===undefined || before===value) return;
    // Authoritative number stays intact; only its arrival moves/fades.
    animate(el,[{translate:'0 3px',opacity:.6,scale:'.98'},{translate:'0 -1px',opacity:1,scale:'1.035',offset:.6},{translate:'0 0',opacity:1,scale:'1'}],300,{key:'pot-value'});
  }
  function award(indices) {
    indices.forEach(index=>{
      if (awarded.has(index)) return;
      awarded.add(index); seat(index)?.classList.add('motion-winner');
      // Highlight only faces already disclosed by the existing client.
      seat(index)?.querySelectorAll('.card.revealed').forEach(el=>el.classList.add('motion-winning-card'));
      const point=center(panel(index)); ring(point,100,600); burst(point,8);
      animate(panel(index),[{scale:'1'},{scale:'1.035',offset:.3},{scale:'1'}],560,{key:`seat-${index}`});
    });
    if (indices.length>1) indices.forEach(index=>scoop(index));
  }
  function scoop(index) { chips(potPoint(),center(panel(index)),1000,true); }
  function init() {
    document.body.classList.add('imdcx-motion-enabled');
    window.addEventListener('resize',()=>clear({settle:true}),{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clear({settle:true});});
    window.addEventListener('pagehide',()=>clear());
    reduce.addEventListener('change',()=>clear({settle:true}));
  }
  window.IMDCXMotion=Object.freeze({prepare,newHand,state,deal,flip,cancelCard,potChanged,award,scoop,clear});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
