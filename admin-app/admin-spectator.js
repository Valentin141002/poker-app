// admin-spectator.js
console.log('>> admin-spectator.js chargé');

(function(){
  // ——— utils pour lire les query params ———
  function getQueryParams(){
    const p = new URLSearchParams(window.location.search);
    return {
      tableID: p.get('table'),
      matchID: p.get('match2')
    };
  }

  const { tableID, matchID } = getQueryParams();
  const metaId   = document.getElementById('meta-id');
  const metaMode = document.getElementById('meta-mode');
  const metaPhase= document.getElementById('meta-phase');
  const boardEl  = document.getElementById('board');
  const playersGrid = document.getElementById('players-grid');

  const socket = io();

  socket.on('connect', () => {
    console.log('[SPECTATOR] connecté, id=', socket.id);
    socket.emit('joinSpectator', {
      tableID,
      matchID
    });
  });

  socket.on('spectatorState', payload => {
    const { type, tableID: tID, matchID: mID, gameState:g } = payload;
    console.log('[SPECTATOR] state reçu', payload);

    // meta header
    if (type === 'table') {
      metaId.textContent   = `Table : ${tID}`;
    } else if (type === 'match2') {
      metaId.textContent   = `Match2 : ${mID}`;
    }
    metaMode.textContent = g.mode ? `Mode : ${g.mode}` : '';
    metaPhase.textContent= g.phase ? `Phase : ${g.phase}` : '';

    renderBoard(g);
    renderPlayers(g);
  });

  function renderBoard(g){
    boardEl.innerHTML = '';
    if (!g.board || !g.board.length) return;
    g.board.forEach(cardCode => {
      const div = document.createElement('div');
      div.className = 'card';
      // Ici tu peux brancher tes visuels de cartes :
      // ex: div.style.backgroundImage = `url(/static/cards/${cardCode}.png)`
      div.textContent = cardCode; // version texte pour l’instant
      boardEl.appendChild(div);
    });
  }

  function renderPlayers(g){
    playersGrid.innerHTML = '';
    if (!g.players || !g.players.length) return;

    g.players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'player-card';

      const h3 = document.createElement('h3');
      h3.textContent = `Seat ${p.seat+1} – ${p.label || 'Player'}`;
      if (typeof g.activeSeat === 'number' && g.activeSeat === p.seat) {
        const badge = document.createElement('span');
        badge.className = 'badge-turn';
        badge.textContent = 'À jouer';
        h3.appendChild(badge);
      }
      card.appendChild(h3);

      const meta = document.createElement('div');
      meta.className = 'player-meta';
      meta.textContent = `Bankroll: ${p.bankroll} | Bet: ${p.subtotal_bet}`;
      card.appendChild(meta);

      const cardsWrapper = document.createElement('div');
      cardsWrapper.className = 'player-cards';

      ['carda','cardb'].forEach(key => {
        const code = p[key];
        if (!code) return;
        const c = document.createElement('div');
        c.className = 'card';
        // branchement visuel possible ici aussi
        c.textContent = code;
        cardsWrapper.appendChild(c);
      });
      card.appendChild(cardsWrapper);

      const st = document.createElement('div');
      st.className = 'player-status';
      st.textContent = `Status: ${p.status || 'ACTIF'}`;
      card.appendChild(st);

      playersGrid.appendChild(card);
    });
  }

})();
