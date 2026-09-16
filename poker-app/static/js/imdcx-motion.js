/* Neon presentation only. The existing client owns cards, turns and payouts. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const jobs = new Map();
  const cardJobs = new WeakMap();
  const potValues = new WeakMap();
  const awarded = new Set();
  const scooped = new Set();
  let epoch = 0, hand = 0, serial = 0, layer, frame = 0, turn = null, energyHand = -1, dealtHand = -1;
  let latestState = null, handPot = 0;
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
  const number = value => Math.max(0, Number(value) || 0);
  const format = value => number(value).toLocaleString('fr-FR');
  const ownSeat = () => typeof mySeatIndex === 'number' ? mySeatIndex : -1;
  const cardBack = () => typeof getThemeCardAssetCssUrl === 'function' ? getThemeCardAssetCssUrl('cardback') : '';
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
  function burst(point, count = 6, gold = false) {
    for (let i=0;i<count;i++) {
      const el = fx('motion-particle',point, i%2 ? 7 : 5); if (!el) break;
      if (gold) el.classList.add('is-gold');
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
  function landing(index, delay = 0, gold = false) {
    const target = panel(index), point = center(target); if (!point) return;
    const el = fx(`motion-seat-landing${gold ? ' is-gold' : ''}`, point, point.width + 8, point.height + 8);
    if (el) animate(el, [
      { transform:'scale(.96)', opacity:0 },
      { transform:'scale(1.035)', opacity:1, offset:.25 },
      { transform:'scale(1.12)', opacity:0 }
    ], 460, { delay, remove:true });
    animate(target, [{scale:'1'}, {scale:'1.035',offset:.35}, {scale:'1'}], 360,
      { key:`seat-${index}`, delay });
  }
  // Paths use viewport coordinates, like the card/chip flights. They never alter
  // table layout, and their endpoints are measured again for every action.
  function trail(from, to, { delay = 0, duration = 540, gold = false } = {}) {
    if (!from || !to || !live()) return;
    const lift = Math.min(65, Math.hypot(to.x-from.x,to.y-from.y)*.18);
    const pad = 18, x = Math.min(from.x,to.x)-pad, y = Math.min(from.y,to.y)-lift-pad;
    const width = Math.abs(to.x-from.x)+pad*2, height = Math.abs(to.y-from.y)+lift+pad*2;
    const wrap = fx(`motion-energy-trail${gold ? ' is-gold' : ''}`, {x:x+width/2,y:y+height/2}, width, height);
    if (!wrap) return;
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
    const d = `M ${from.x-x} ${from.y-y} Q ${(from.x+to.x)/2-x} ${(from.y+to.y)/2-y-lift} ${to.x-x} ${to.y-y}`;
    ['motion-energy-path motion-energy-glow','motion-energy-path'].forEach(className => {
      const path = document.createElementNS(ns,'path');
      path.setAttribute('d',d); path.setAttribute('class',className); path.setAttribute('pathLength','1');
      path.style.strokeDasharray = '1'; svg.appendChild(path);
      animate(path,[{strokeDashoffset:'1',opacity:0},{strokeDashoffset:'.6',opacity:1,offset:.3},
        {strokeDashoffset:'0',opacity:1,offset:.72},{strokeDashoffset:'0',opacity:0}],duration,{delay});
    });
    wrap.appendChild(svg);
    animate(wrap,[{opacity:0},{opacity:1,offset:.08},{opacity:1,offset:.8},{opacity:0}],duration,{delay,remove:true});
  }
  function amountBadge(point, amount, payout = false, delay = 0) {
    if (!point || amount <= 0) return;
    const width = Math.min(150, Math.max(66, String(Math.round(amount)).length*12 + 22));
    const badge = fx(`motion-amount${payout ? ' is-payout' : ''}`,
      {x:Math.max(width/2+4,Math.min(innerWidth-width/2-4,point.x)),y:point.y+point.height*.27},width,30);
    if (!badge) return;
    badge.textContent = `${payout ? '+' : '−'} ${format(amount)}`;
    animate(badge,[{transform:'translateY(6px) scale(.8)',opacity:0},
      {transform:'translateY(0) scale(1.05)',opacity:1,offset:.2},
      {transform:'translateY(-5px) scale(1)',opacity:1,offset:.65},
      {transform:'translateY(-18px) scale(.95)',opacity:0}],850,{delay,remove:true});
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
    clear(); hand++; awarded.clear(); scooped.clear(); turn=null; handPot=number(next.pot); latestState=next;
    document.querySelectorAll('.motion-winner,.motion-winning-card').forEach(el=>el.classList.remove('motion-winner','motion-winning-card'));
  }
  function newHand(prev, next, callbacks = {}) {
    if (next?.phase !== 'preflop' || (prev && prev.phase === 'preflop'
      && prev.demoRoomID === next.demoRoomID && prev.roundNumber === next.roundNumber)) return false;
    latestState = next;
    // Reset painters synchronously; no visual effect blocks a server update.
    callbacks.onSwallow?.(); callbacks.onComplete?.();
    newHandEnergy();
    return true;
  }
  function newHandEnergy() {
    if (energyHand === hand) return;
    const pot=potPoint(); if (!pot) return;
    const table=center(document.getElementById('poker_table'));
    const size=Math.min(520,innerWidth*.76,(table?.width || innerWidth)*.78);
    const point={x:pot.x,y:pot.y-size*.12};
    const scene=fx('motion-vortex motion-vortex-scene',point,size,size*.82); if (!scene) return;
    energyHand=hand;
    const part=className=>{const el=document.createElement('span');el.className=className;scene.appendChild(el);return el;};
    const halo=part('motion-vortex-halo');
    animate(halo,[{transform:'scale(.35)',opacity:0},{transform:'scale(.9)',opacity:.9,offset:.32},
      {transform:'scale(1.15)',opacity:0}],790);
    for(let i=0;i<5;i++) {
      const orbit=part('motion-vortex-orbit'); orbit.style.setProperty('--orbit-i',i);
      const scale=.42+i*.13;
      animate(orbit,[{transform:`rotateX(58deg) rotateZ(${i*46-150}deg) scale(${scale*.25})`,opacity:0},
        {transform:`rotateX(58deg) rotateZ(${i*46+45}deg) scale(${scale})`,opacity:1,offset:.36},
        {transform:`rotateX(58deg) rotateZ(${i*46+250}deg) scale(${scale*.14})`,opacity:0}],790);
    }
    const beam=part('motion-vortex-beam'), core=part('motion-vortex-core');
    animate(beam,[{transform:'scaleY(.15)',opacity:0},{transform:'scaleY(1)',opacity:.9,offset:.32},
      {transform:'scaleY(.05)',opacity:0}],700);
    animate(core,[{transform:'scale(.2)',opacity:0},{transform:'scale(1)',opacity:1,offset:.38},
      {transform:'scale(.1)',opacity:0}],780);
    for(let i=0;i<4;i++) {
      const card=part('motion-card-flight motion-orbit-card');
      const width=Math.max(20,size*.092),angle=i*Math.PI/2;
      Object.assign(card.style,{width:`${width}px`,height:`${width*1.4}px`,left:`calc(50% - ${width/2}px)`,
        top:`calc(56% - ${width*.7}px)`,backgroundImage:cardBack()});
      animate(card,[{transform:`translate3d(${Math.cos(angle)*size*.12}px,${Math.sin(angle)*size*.07}px,0) rotate(-45deg) scale(.2)`,opacity:0},
        {transform:`translate3d(${Math.cos(angle+.8)*size*.35}px,${Math.sin(angle+.8)*size*.2-20}px,0) rotate(${i%2?-22:18}deg) scale(1)`,opacity:1,offset:.48},
        {transform:`translate3d(${Math.cos(angle+1.7)*size*.08}px,${Math.sin(angle+1.7)*size*.07}px,0) rotate(60deg) scale(.1)`,opacity:0}],740);
    }
    animate(scene,[{opacity:0},{opacity:1,offset:.1},{opacity:1,offset:.78},{opacity:0}],800,{remove:true});
    burst(point,4);
  }
  function chips(from, to, amount, payout = false, limit = 5) {
    if (!from || !to || amount <= 0 || !live()) return;
    const count = Math.min(limit, Math.max(2,Math.ceil(Math.log10(amount+1))));
    for (let i=0;i<count;i++) {
      const el=fx(`motion-chip${payout ? ' is-payout' : ''}`,from,Math.min(34,Math.max(17,innerWidth*.05))); if (!el) break;
      const textures = typeof BET_CHIP_TEXTURES !== 'undefined' ? BET_CHIP_TEXTURES : [];
      if (textures.length) el.style.backgroundImage=`url("${textures[i%textures.length]}")`;
      const dx=to.x-from.x+(i%2 ? 3 : -3),dy=to.y-from.y;
      animate(el,[{transform:`translate3d(${i*2}px,0,0) rotate(-12deg) scale(.82)`,opacity:0},
        {transform:`translate3d(${dx*.38}px,${dy*.38-20}px,0) rotate(35deg) scale(1.05)`,opacity:1,offset:.35},
        {transform:`translate3d(${dx*.9}px,${dy*.9-5}px,0) rotate(65deg) scale(.95)`,opacity:1,offset:.86},
        {transform:`translate3d(${dx}px,${dy}px,0) rotate(80deg) scale(.6)`,opacity:0}],payout?680:500,
        {delay:i*40,remove:true,done:i===0?()=>ring(to,42,280):undefined});
    }
    trail(from,to,{gold:payout,duration:payout?760:620});
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
    else if (delta>0) { chips(point,potPoint(),delta); amountBadge(point,delta); landing(index); }
    if (label==='ALL-IN') burst(point,6);
  }
  function state(prev, next) {
    latestState=next;
    const sameHand=prev && prev.demoRoomID===next.demoRoomID && prev.roundNumber===next.roundNumber
      && !(next.phase==='preflop' && prev.phase!=='preflop');
    handPot=Math.max(handPot,sameHand?number(prev.pot):0,number(next.pot));
    const active=next.phase==='reveal' ? next.revealSeq?.activeSeat : next.current_bettor_index;
    if (active !== turn) {
      const target=panel(active);
      if (target) { landing(active); animate(target,[{translate:'0 2px',scale:'.99'},{translate:'0 -2px',scale:'1.025',offset:.5},{translate:'0 0',scale:'1'}],400,{key:'turn'}); }
      turn=active;
    }
    if (!sameHand) return;
    const index=prev.current_bettor_index, before=prev.players?.[index], after=next.players?.[index];
    if (!before || !after || !['preflop','flop','turn','river'].includes(prev.phase)) return;
    const status=String(after.status || '').toUpperCase();
    const passed=prev.phase!==next.phase || next.current_bettor_index!==index;
    const delta=Math.max(0,number(before.bankroll)-number(after.bankroll),number(after.subtotal_bet)-number(before.subtotal_bet));
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
    if (dealtHand===hand) return;
    dealtHand=hand;
    newHandEnergy();
    const run=epoch;
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      frame=0; if (run!==epoch) return;
      const players=latestState?.players || (typeof currentGameState!=='undefined' ? currentGameState?.players : []);
      (players||[]).forEach((player,index)=>{
        if (!player || player.inactive || ['BUST','WAIT'].includes(player.status)) return;
        const point=center(panel(index)); if (!point) return;
        const delay=420+Math.min(index*22,180),width=Math.max(20,Math.min(48,point.width*.42));
        trail(origin,point,{delay,duration:490});
        landing(index,delay+350);
        for (let n=0;n<2;n++) {
          const card=fx('motion-card-flight',origin,width,width*1.38); if (!card) break;
          card.style.backgroundImage=cardBack();
          const dx=point.x-origin.x+(n?5:-5),dy=point.y-origin.y;
          animate(card,[{transform:'translate3d(0,0,0) rotateX(35deg) rotateZ(-12deg) scale(.45)',opacity:0},
            {transform:`translate3d(${dx*.55}px,${dy*.55-18}px,0) rotateX(12deg) rotateZ(${n?12:-12}deg) scale(1)`,opacity:1,offset:.58},
            {transform:`translate3d(${dx*.96}px,${dy*.96}px,0) rotateX(0deg) rotateZ(${n?8:-8}deg) scale(.9)`,opacity:1,offset:.9},
            {transform:`translate3d(${dx}px,${dy}px,0) rotateX(0deg) rotateZ(0deg) scale(.55)`,opacity:0}],440,
            {delay:delay+n*60,remove:true});
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
    handPot=Math.max(handPot,value);
    if (before===undefined || before===value) return;
    // Authoritative number stays intact; only its arrival moves/fades.
    animate(el,[{translate:'0 3px',opacity:.6,scale:'.98'},{translate:'0 -1px',opacity:1,scale:'1.035',offset:.6},{translate:'0 0',opacity:1,scale:'1'}],300,{key:'pot-value'});
  }
  function award(indices, options = {}) {
    const winners=[...new Set((indices || []).filter(index=>Number.isInteger(index) && panel(index)))];
    const fresh=winners.filter(index=>!awarded.has(index));
    if (!fresh.length) return;
    const amount=number(options.amount) || handPot;
    fresh.forEach((index,order)=>{
      if (awarded.has(index)) return;
      awarded.add(index); seat(index)?.classList.add('motion-winner');
      // Highlight only faces already disclosed by the existing client.
      seat(index)?.querySelectorAll('.card.revealed').forEach(el=>el.classList.add('motion-winning-card'));
      const point=center(panel(index)); landing(index,0,true);
      if (winners.length<=3 || order<3) burst(point,winners.length<=3?6:2,true);
      animate(panel(index),[{scale:'1'},{scale:'1.035',offset:.3},{scale:'1'}],560,{key:`seat-${index}`});
    });
    const point=potPoint();
    if (point) {
      const width=Math.min(380,innerWidth*.62),height=Math.max(78,width*.33);
      const banner=fx(`motion-victory${winners.includes(ownSeat())?' is-own':''}`,point,width,height);
      if (banner) {
        const add=(name,text)=>{const el=document.createElement('span');el.className=name;el.textContent=text;banner.appendChild(el);};
        add('motion-victory-crown','♛');
        add('motion-victory-title',winners.length>1?'SPLIT POT':winners[0]===ownSeat()?'YOU WIN !!':`P${winners[0]+1} WINS`);
        add('motion-victory-amount',amount>0?`POT : ${format(amount)}`:'');
        animate(banner,[{transform:'scale(.72) translateY(12px)',opacity:0},
          {transform:'scale(1.04) translateY(0)',opacity:1,offset:.16},
          {transform:'scale(1) translateY(0)',opacity:1,offset:.32},
          {transform:'scale(1) translateY(0)',opacity:1,offset:.84},
          {transform:'scale(.98) translateY(-6px)',opacity:0}],1500,{key:'victory',remove:true});
      }
    }
    fresh.forEach(index=>scoop(index,number(options.payouts?.[index]) || (winners.length===1?amount:0),winners.length>1?2:5));
  }
  function scoop(index, amount = 0, chipLimit = 5) {
    if (scooped.has(index)) return;
    const from=potPoint(),to=center(panel(index)); if (!from || !to) return;
    scooped.add(index);
    // Chip sprites are decorative. Only an explicitly known award receives a
    // numeric label; a split pot is never divided or calculated by this module.
    chips(from,to,amount || handPot || 1,true,chipLimit);
    if (amount>0) amountBadge(to,amount,true,420);
  }
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
