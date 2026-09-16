/* Live-renderer regression fixture. Card values come from the isolated real
   demo engine; only browser presentation snapshots are changed after disconnect. */
'use strict';
const assert = require('node:assert/strict');

module.exports = async ({ cdp, evaluate, wait, screenshot, check, delay, port }) => {
  const selected = Number(process.argv.find(arg => arg.startsWith('--viewport='))?.split('=')[1]);
  const width = selected || 390;
  const height = width >= 1000 ? 900 : width === 320 ? 740 : 844;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, mobile:width < 1000, deviceScaleFactor:1 });
  await cdp('Emulation.setEmulatedMedia', { features:[] });
  await cdp('Page.navigate', { url:`http://127.0.0.1:${port}/poker.html?demo=10` });
  await wait("typeof currentGameState !== 'undefined' && currentGameState?.demo && !!window.IMDCXMotion");
  await evaluate('window.__imdcxFinishPortalIntro?.()');

  // Obtain an ordinary showdown without introducing a made-up hand or winner.
  for (let n = 0; n < 45; n++) {
    if (await evaluate("currentGameState.phase === 'reveal'")) break;
    const revision = await evaluate('currentGameState.demoRevision');
    await evaluate('human_check_call()');
    await wait(`currentGameState.demoRevision > ${revision}`);
  }
  await wait("currentGameState.phase === 'reveal' && currentGameState.board.length === 5");
  await evaluate(`(() => {
    window.__liveFixture = structuredClone(currentGameState);
    socket.disconnect();
    const fixture = __liveFixture;
    fixture.demo = false;
    delete fixture.demoRoomID;
    fixture.roundNumber += 100;
    fixture.gameFinished = false;
    fixture.roundEvaluated = false;
    fixture.revealSeqDone = false;
    fixture.revealSeq = { ...fixture.revealSeq, activeSeat:0, done:false };
    fixture.players.forEach(p => { p.revealStatus = null; });
    mySeatIndex = 0;
    mySocketId = fixture.players[0].id;
    isPublicSpectator = false;
    endStateLocked = false;
    gameOverFreezeActive = false;
    revealShownSeats.clear();
    revealDisplayedCards = {};
    revealedAllSeats = false;
    revealFlowToken++;
    lastPhase = 'preflop';
    myCardAnimRunId++;
    clearTimeout(myCardsFlipTimer);
    IMDCXMotion.clear();
    resetBoardRenderState();
    document.body.classList.remove('manual-demo-mode', 'final-end-ui');
    document.getElementById('manual-demo-tools')?.remove();
    document.querySelectorAll('#poker_table .seat').forEach(seat => {
      seat.classList.remove('demo-card-shown', 'demo-reveal-active', 'demo-has-seat-cards');
    });
    window.__paintLiveFixture = () => {
      handleGameStateUpdate(structuredClone(__liveFixture));
      refreshResponsiveScaleAfterRender();
    };
    window.__liveReview = index => {
      const seat = document.getElementById('seat' + index);
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom }; };
      const visible = el => {
        if (!el.getBoundingClientRect().width) return false;
        for (let node = el; node; node = node.parentElement) {
          const css = getComputedStyle(node);
          if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
        }
        return true;
      };
      return {
        own:seat.classList.contains('my-seat'), classes:seat.className,
        panel:rect(seat.querySelector('.name-chips')),
        cards:[...seat.querySelectorAll('.holecards .card')].map((card, n) => {
          const code = n ? __liveFixture.players[index].cardb : __liveFixture.players[index].carda;
          const reference = document.createElement('div');
          reference.style.backgroundImage = internal_GetCardImageUrl(code);
          document.body.appendChild(reference);
          const expected = getComputedStyle(reference).backgroundImage;
          reference.remove();
          return { code, dataset:card.dataset.cardCode, face:getComputedStyle(card).backgroundImage === expected,
            revealed:card.classList.contains('revealed'), visible:visible(card), rect:rect(card) };
        })
      };
    };
    __paintLiveFixture();
  })()`);
  const intersection = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  const shown = async (index, label) => {
    await wait(`__liveReview(${index}).cards.every(c => c.face && c.revealed && c.visible && c.dataset === c.code)`);
    await delay(450);
    const info = await evaluate(`__liveReview(${index})`);
    assert.ok(intersection(info.cards[0].rect, info.cards[1].rect), `${label}: cards overlap`);
    assert.ok(info.cards.every(card => intersection(card.rect, info.panel)), `${label}: stack belongs to its seat`);
    check(label, true);
  };
  const concealed = async (index, label) => {
    const info = await evaluate(`__liveReview(${index})`);
    check(label, info.cards.every(card => !card.revealed && !card.face && (!card.visible || card.dataset === 'blinded')));
  };

  await wait("__liveReview(0).cards.every(c => c.visible && c.dataset === 'blinded')");
  check('Live reveal: current choosing seat shows backs, not its private faces', await evaluate("__liveReview(0).own && __liveReview(0).classes.includes('reveal-active') && __liveReview(0).cards.every(c => !c.face && !c.revealed)"));
  await concealed(1, 'Live reveal: opponents stay concealed before SHOW');

  await evaluate("__liveFixture.players[0].revealStatus = 'show'; __liveFixture.revealSeq.activeSeat = 1; __paintLiveFixture()");
  await shown(0, 'Live reveal: local SHOW flips to real faces stacked on the seat');
  await screenshot(`${width}-live-owned-show`);

  // Rendering must obey an explicit HIDE even if a previous paint had faces.
  await evaluate("__liveFixture.players[0].revealStatus = 'hide'; __paintLiveFixture()");
  await concealed(0, 'Live reveal: HIDE clears previous faces and card metadata');
  await evaluate(`(() => {
    backgroundThemeOverride = 'forceFruity'; applyTierBackgroundTheme(currentGameState);
    document.querySelectorAll('#seat0 .holecards .card').forEach((card, n) => {
      internal_setCard(card, n ? __liveFixture.players[0].cardb : __liveFixture.players[0].carda, false);
    });
    backgroundThemeOverride = 'forceDark'; applyTierBackgroundTheme(currentGameState);
  })()`);
  await delay(900);
  await concealed(0, 'Live reveal: theme refresh and late face paints cannot expose HIDE');

  await evaluate("__liveFixture.players[1].revealStatus = 'show'; __liveFixture.revealSeq.activeSeat = 2; __paintLiveFixture()");
  await shown(1, 'Live reveal: opponent SHOW uses real faces and the same seat stack');
  await evaluate("isPublicSpectator = true; mySeatIndex = null; mySocketId = ''; __paintLiveFixture()");
  check('Live spectator: no seat becomes a private local hand', await evaluate("!document.querySelector('#poker_table .my-seat')"));
  await shown(1, 'Live spectator: disclosed cards remain visible and correctly stacked');
  await wait("__liveReview(2).cards.every(c => c.visible && c.dataset === 'blinded')");
  await concealed(0, 'Live spectator: hidden hands remain concealed');
  await screenshot(`${width}-live-spectator-show`);

  await evaluate(`(() => {
    __liveFixture.roundNumber++;
    __liveFixture.phase = 'preflop';
    __liveFixture.board = [];
    __liveFixture.revealSeq = null;
    __liveFixture.revealSeqDone = false;
    __liveFixture.current_bettor_index = 0;
    __liveFixture.players.forEach(p => { p.revealStatus = null; p.inShowdown = false; });
    __paintLiveFixture();
  })()`);
  await delay(1400);
  check('Live spectator: next hand removes old public cards and pending reveal paints', await evaluate("!document.querySelector('.motion-flipping') && __liveFixture.players.every((p, i) => __liveReview(i).cards.every(c => !c.visible && !c.revealed && !c.dataset))"));
  check('Live spectator: new community row returns to five backs', await evaluate("['flop1','flop2','flop3','turn','river'].every(id => document.getElementById(id).dataset.hasBack === '1' && !document.getElementById(id).classList.contains('revealed'))"));
  await screenshot(`${width}-live-next-hand`);
};
