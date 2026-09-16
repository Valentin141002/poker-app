/* Manual seat controller for the existing poker client. No poker rules here. */
(() => {
  'use strict';
  let toolbar;
  let showAll = false;
  let pending = false;
  let lastPacket = '';
  const shownCards = new Map();

  // Public seat cards follow the server's SHOW/HIDE decision, independently of
  // the seat currently controlled by this browser. No poker decisions here.
  function renderRevealCards(state) {
    if (!state?.demo || state.phase !== 'reveal') return false;
    state.players.forEach((player, index) => {
      const seat = document.getElementById(`seat${index}`);
      const cards = seat?.querySelectorAll('.holecards .card');
      if (!cards || cards.length !== 2) return;
      const shown = player.revealStatus === 'show' && player.carda && player.cardb;
      const choosing = !state.revealSeq?.done && state.revealSeq?.activeSeat === index;
      seat.classList.toggle('card-shown', !!shown);
      seat.classList.toggle('demo-card-shown', !!shown);
      seat.classList.toggle('demo-reveal-active', choosing);
      seat.classList.toggle('demo-has-seat-cards', !!shown || choosing);
      if (!shown) {
        cards.forEach(card => {
          window.IMDCXMotion?.cancelCard(card);
          internal_setCard(card, choosing ? 'blinded' : '', false, choosing);
          card.classList.toggle('visible', choosing);
        });
        return;
      }
      const key = `${state.demoRoomID}:${state.roundNumber}:${index}:${player.carda}:${player.cardb}`;
      const stillCurrent = () => currentGameState?.demoRoomID === state.demoRoomID
        && currentGameState.roundNumber === state.roundNumber
        && currentGameState.phase === 'reveal'
        && currentGameState.players[index]?.revealStatus === 'show'
        && currentGameState.players[index]?.carda === player.carda
        && currentGameState.players[index]?.cardb === player.cardb;
      const started = shownCards.get(key);
      if (started === undefined) {
        shownCards.set(key, performance.now());
        cards.forEach(card => {
          internal_setCard(card, 'blinded', false, true);
          card.classList.add('visible');
        });
        flipCardsSimultaneously(cards[0], cards[1], player.carda, player.cardb,
          { isCurrent: stillCurrent, forceTransform: true });
      } else if (performance.now() - started >= 650 && !Array.from(cards).some(card => card.classList.contains('motion-flipping'))) {
        // A theme refresh or a legacy winner reset must not put shown cards back.
        gui_set_player_cards(player.carda, player.cardb, index, false);
        cards.forEach(card => card.classList.add('visible'));
      }
      revealShownSeats.add(index);
      revealDisplayedCards[index] = { carda: player.carda, cardb: player.cardb };
    });
    window.IMDCXTable?.layoutSeatCards(document.getElementById('poker_table'), state);
    return true;
  }

  function selection() {
    const screen = document.createElement('section');
    screen.className = 'demo-selection';
    screen.innerHTML = `<h1>DÉMO</h1><p>Vous contrôlez chaque joueur. Aucun impact sur votre compte.</p>
      <button type="button" data-seats="2">FACE-À-FACE — 2 JOUEURS</button>
      <button type="button" data-seats="10">TABLE — 10 JOUEURS</button>
      <button type="button" data-back>Retour</button>`;
    screen.querySelectorAll('[data-seats]').forEach(button => button.addEventListener('click', () => {
      window.location.href = `${window.location.pathname}?demo=${button.dataset.seats}`;
    }));
    screen.querySelector('[data-back]').onclick = () => window.IMDCXScenes.leave(screen);
    window.IMDCXScenes.enter('demo-selection', screen);
  }

  function cardLabel(card) {
    if (!card) return '—';
    const rank = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[card.slice(1)] || card.slice(1);
    return rank + ({ h: '♥', d: '♦', c: '♣', s: '♠' }[card[0]] || '');
  }

  function renderTools(state) {
    const seat = state.phase === 'reveal' ? state.revealSeq?.activeSeat : state.current_bettor_index;
    toolbar.querySelector('[data-turn]').textContent = state.gameFinished
      ? `Partie terminée — ${state.winReason?.winnerLabel || 'Fin'}`
      : state.phase === 'reveal' && state.revealSeq?.done ? 'Main terminée'
      : state.demoRunningOut && state.phase !== 'reveal' ? 'Distribution du tableau…'
      : Number.isInteger(seat) ? `À vous de jouer : P${seat + 1}` : 'Fin de main';
    toolbar.querySelector('[data-next]').disabled = !!state.gameFinished;
    const cards = toolbar.querySelector('[data-cards]');
    cards.hidden = !showAll;
    cards.replaceChildren();
    if (showAll) state.players.forEach((player, i) => {
      const row = document.createElement('span');
      row.textContent = `P${i + 1} : ${cardLabel(player.carda)} ${cardLabel(player.cardb)}`;
      cards.appendChild(row);
    });
  }

  function receive(state) {
    if (!state?.demo) return;
    // The engine also emits updateTable during duel runouts. Render each state once.
    const packet = JSON.stringify(state);
    if (packet === lastPacket) return;
    lastPacket = packet;
    pending = false;
    const newRoom = currentGameState?.demoRoomID !== state.demoRoomID;
    const oldSeat = mySeatIndex;
    const revealSeat = state.revealSeq?.activeSeat;
    const nextSeat = state.phase === 'reveal' && Number.isInteger(revealSeat)
      ? revealSeat : state.current_bettor_index;
    if (newRoom || oldSeat !== nextSeat) {
      myCardAnimRunId++;
      if (newRoom || state.phase !== 'reveal' || currentGameState?.phase !== 'reveal') resetMySeatBacks();
    }
    if (Number.isInteger(nextSeat) && state.players[nextSeat]) mySeatIndex = nextSeat;
    mySocketId = state.players[mySeatIndex]?.id || '';
    isMatch2 = state.players.length === 2;
    _tableID = isMatch2 ? null : state.demoRoomID;
    _match2ID = isMatch2 ? state.demoRoomID : null;
    gameMode = state.mode;
    if (newRoom) {
      shownCards.clear();
      revealShownSeats.clear();
      document.querySelectorAll('#poker_table .seat').forEach(seat => {
        seat.classList.remove('demo-card-shown', 'demo-reveal-active', 'demo-has-seat-cards', 'card-shown');
      });
      lastPhase = null;
      // demo:next hands out a fresh demoRoomID even for a plain "next hand" (it
      // just retires the previous room's pending server timers) - nulling
      // currentGameState here would erase the reveal-phase prevState that
      // handleGameStateUpdate needs to detect reveal -> preflop and play the
      // hand-tornado vortex, so leave it for handleGameStateUpdate to replace.
      revealedAllSeats = false;
      revealFlowToken++;
      resetBoardRenderState();
      clearWinnerMessage();
    }
    if (newRoom || oldSeat !== mySeatIndex) {
      if (isCalcOpen()) calcClose();
      myCardsRevealed = false;
      myLastKnownHoleCards = null;
      myCardsBackLockUntil = 0;
    }
    removeLoadingScreenNow();
    gui_show_poker_table();
    handleGameStateUpdate(state);
    if (newRoom && state.phase === 'preflop') { resetAllBacks(null, state); setupBoardBacks(); animateMyCards(); }
    else if (state.phase !== 'reveal') restoreMyCardsIfNeeded(state, { force: true });
    renderRevealCards(state);
    if (state.phase === 'reveal' && Number.isInteger(revealSeat) && !state.revealSeq.done) showRevealButton();
    else hideRevealButton();
    if (state.demoRunningOut || state.gameFinished) { gui_hide_fold_call_click(); disableRaiseButton(); }
    renderTools(state);
    refreshResponsiveScaleAfterRender();
    centerTableOnce();
  }

  function start(seats) {
    document.body.classList.add('manual-demo-mode');
    toolbar = document.createElement('aside');
    toolbar.id = 'manual-demo-tools';
    toolbar.setAttribute('aria-label', 'Commandes de démo');
    toolbar.innerHTML = `<strong>DÉMO · ${seats} joueurs</strong><span data-turn role="status">Connexion…</span>
      <label><input type="checkbox" data-all> Voir toutes les cartes</label>
      <button type="button" data-next>Nouvelle main</button>
      <button type="button" data-restart>Recommencer la partie</button>
      <button type="button" data-quit>Quitter la démo</button>
      <div data-cards hidden></div>`;
    document.body.appendChild(toolbar);
    toolbar.querySelector('[data-all]').onchange = event => {
      showAll = event.target.checked;
      if (currentGameState) renderTools(currentGameState);
    };
    socket = io({ query: { demo: '1' } });
    const emit = socket.emit.bind(socket);
    socket.emit = (event, payload, ...rest) => {
      if (event === 'playerAction' || event === 'revealChoice') {
        if (pending || !socket.connected || !currentGameState?.demo) return socket;
        if (event === 'playerAction' && (currentGameState.demoRunningOut || currentGameState.gameFinished)) return socket;
        payload = { ...payload, demoRoomID: currentGameState.demoRoomID, demoRound: currentGameState.roundNumber,
          demoRevision: currentGameState.demoRevision, demoSeat: mySeatIndex };
        // Revision/seat checks on the server reject double-clicks and old decisions.
      }
      return emit(event, payload, ...rest);
    };
    const reset = event => {
      pending = true;
      socket.emit(event, {}, result => {
        pending = false;
        if (!result?.ok) showErrorToast(result?.error || 'Démo indisponible.');
      });
    };
    toolbar.querySelector('[data-next]').onclick = () => reset('demo:next');
    toolbar.querySelector('[data-restart]').onclick = () => reset('demo:restart');
    toolbar.querySelector('[data-quit]').onclick = () => {
      socket.emit('demo:quit', {});
      socket.disconnect();
      window.location.href = window.location.pathname;
    };
    socket.on('connect', () => { lastPacket = ''; socket.emit('demo:start', { seats }); });
    socket.on('startGame', data => receive(data.gameState));
    socket.on('updateTable', receive);
    socket.on('updateMatch2', data => receive(data.gameState));
    socket.on('disconnect', () => {
      pending = true;
      toolbar.querySelector('[data-turn]').textContent = 'Déconnecté — une nouvelle démo démarrera à la reconnexion.';
      gui_hide_fold_call_click(); disableRaiseButton();
    });
    socket.on('connect_error', () => { toolbar.querySelector('[data-turn]').textContent = 'Connexion au serveur impossible. Nouvelle tentative…'; });
  }

  window.IMDCXDemo = { selection, start, renderRevealCards };
})();
