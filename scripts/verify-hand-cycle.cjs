/* Browser regression for the existing server-owned hand loop. Uses only the
   isolated server and temporary databases provided by verify-manual-demo.cjs. */
'use strict';
const assert = require('node:assert/strict');

module.exports = async ({ cdp, evaluate, wait, screenshot, check, delay, port }) => {
  const metrics = [];
  await cdp('Emulation.setDeviceMetricsOverride', { width:1440, height:900, mobile:false, deviceScaleFactor:1 });
  for (const reduced of [false, true]) {
    await cdp('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:reduced ? 'reduce' : 'no-preference' }] });
    for (const seats of [2, 10]) {
      const label = `demo=${seats}/${reduced ? 'reduced' : 'animated'}`;
      console.log(`${label}: loading`);
      await cdp('Page.navigate', { url:`http://127.0.0.1:${port}/poker.html?demo=${seats}` });
      await wait(`typeof currentGameState !== 'undefined' && currentGameState?.demo && currentGameState.players.length === ${seats} && !!window.IMDCXMotion`);
      await evaluate('window.__imdcxFinishPortalIntro?.()');
      await evaluate(`(() => {
        window.__handCycle = { packets:[], transitions:[], effects:[], commands:[] };
        socket.onAny((event, data) => {
          const state = data?.gameState || data;
          if (!state?.demo) return;
          __handCycle.packets.push({ event, time:Date.now(), room:state.demoRoomID,
            round:state.roundNumber, phase:state.phase, revision:state.demoRevision,
            evaluated:state.roundEvaluated, revealDone:!!state.revealSeq?.done });
        });
        const motion = IMDCXMotion;
        window.IMDCXMotion = Object.freeze({ ...motion, newHand(prev, next, callbacks) {
          const started = motion.newHand(prev, next, callbacks);
          if (started) __handCycle.transitions.push({ room:next.demoRoomID, round:next.roundNumber });
          return started;
        }});
        new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
          if (node.nodeType === 1 && /motion-vortex-scene|motion-victory|motion-card-flight/.test(node.className || '')) {
            __handCycle.effects.push({ classes:node.className, round:currentGameState.roundNumber });
          }
        }))).observe(document.body, { childList:true, subtree:true });
        const emit = socket.emit;
        socket.emit = function(event, ...args) {
          if (event === 'demo:next') __handCycle.commands.push({ event, payload:args[0] });
          return emit.call(this, event, ...args);
        };
      })()`);
      for (let hand = 0; hand < 2; hand++) {
        const before = await evaluate('({ room:currentGameState.demoRoomID, round:currentGameState.roundNumber, dealer:currentGameState.dealerIndex })');
        for (let action = 0; action < seats * 5 + 4; action++) {
          if (await evaluate("currentGameState.phase === 'reveal'")) break;
          const revision = await evaluate('currentGameState.demoRevision');
          await evaluate('human_check_call()');
          await wait(`currentGameState.demoRevision > ${revision}`);
        }
        await wait("currentGameState.phase === 'reveal' && Number.isInteger(currentGameState.revealSeq?.activeSeat)");
        for (let choice = 0; choice < seats; choice++) {
          if (await evaluate('!!currentGameState.revealSeq?.done')) break;
          const actor = await evaluate('currentGameState.revealSeq.activeSeat');
          await wait("document.querySelector('.reveal-card-btn.show.reveal-overlay')?.getAttribute('aria-disabled') === 'false'");
          await evaluate("document.querySelector('.reveal-card-btn.show.reveal-overlay').click()");
          await wait(`currentGameState.players[${actor}].revealStatus === 'show'`);
        }
        await wait('currentGameState.roundEvaluated && currentGameState.revealSeq?.done');
        check(`${label}/hand${hand + 1}: payout completes`, await evaluate('currentGameState.players.some(p => p.status === "WINNER") && currentGameState.pot === 0'));
        console.log(`${label}/hand${hand + 1}: waiting for automatic next hand`);
        await wait(`currentGameState.roundNumber === ${before.round + 1} && currentGameState.phase === 'preflop'`);
        await delay(1400);
        const info = await evaluate(`({
          room:currentGameState.demoRoomID, round:currentGameState.roundNumber, dealer:currentGameState.dealerIndex,
          board:currentGameState.board, revealSeq:currentGameState.revealSeq,
          revealTimer:revealPromptTimer, evaluated:currentGameState.roundEvaluated,
          oldRevealClasses:document.querySelectorAll('.demo-card-shown,.demo-reveal-active,.demo-has-seat-cards').length,
          boardReset:['flop1','flop2','flop3','turn','river'].every(id => document.getElementById(id).dataset.hasBack === '1' && !document.getElementById(id).classList.contains('revealed')),
          ownCards:[...document.querySelectorAll('.my-seat .holecards .card')].map((card,n) => ({
            code:card.dataset.cardCode, expected:n ? currentGameState.players[mySeatIndex].cardb : currentGameState.players[mySeatIndex].carda
          })),
          nextEnabled:!document.querySelector('[data-next]').disabled,
          transitions:__handCycle.transitions.filter(t => t.round === ${before.round + 1}),
          effects:__handCycle.effects.filter(e => e.round === ${before.round + 1}),
          rounds:[...new Set(__handCycle.packets.map(packet => packet.round))]
        })`);
        assert.equal(info.room, before.room, `${label}: automatic next hand keeps the room`);
        check(`${label}/hand${hand + 1}: exactly one new-hand transition`, info.transitions.length === 1);
        check(`${label}/hand${hand + 1}: reveal timer and cards reset`, info.revealTimer === null && info.oldRevealClasses === 0 && info.boardReset && !info.evaluated);
        check(`${label}/hand${hand + 1}: dealer rotates once`, info.dealer === (before.dealer + 1) % seats);
        check(`${label}/hand${hand + 1}: new private cards and controls ready`, info.nextEnabled && info.ownCards.length === 2 && info.ownCards.every(card => card.code === card.expected));
        if (!reduced) check(`${label}/hand${hand + 1}: transition animation runs`, info.effects.some(effect => effect.classes.includes('motion-vortex-scene')));
        else check(`${label}/hand${hand + 1}: reduced motion needs no animation callback`, info.effects.length === 0);
        assert.deepEqual(info.rounds, Array.from({ length:hand + 2 }, (_, index) => index + 1), `${label}: no skipped or duplicate automatic hand`);
        metrics.push({ label, completedRound:before.round, ...info });
        const revision = await evaluate('currentGameState.demoRevision');
        await evaluate('human_check_call()');
        await wait(`currentGameState.demoRevision > ${revision}`);
        check(`${label}/hand${hand + 1}: betting resumes`, true);
      }
      const round = await evaluate('currentGameState.roundNumber');
      await evaluate("document.querySelector('[data-next]').click(); document.querySelector('[data-next]').click()");
      await wait(`currentGameState.roundNumber === ${round + 1} && currentGameState.phase === 'preflop'`);
      await delay(1500);
      check(`${label}: double click starts exactly one hand`, await evaluate(`__handCycle.commands.length === 1 && currentGameState.roundNumber === ${round + 1} && __handCycle.transitions.filter(t => t.round === ${round + 1}).length === 1`));
      await screenshot(`hand-cycle-${seats}-${reduced ? 'reduced' : 'animated'}`);
    }
  }
  return metrics;
};
