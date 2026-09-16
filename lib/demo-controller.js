'use strict';

const { randomUUID } = require('node:crypto');

// Session/seat ownership only. Dealing, betting, evaluation and hand progression
// are supplied by the existing server engine.
function registerDemoController(socket, engine) {
  const { tables, matches, states, tableWaiting, matchWaiting } = engine;
  const REVEAL_WINNER_MS = engine.revealWinnerDelayMs || 10000;
  const privateEntry = (map, key, value) => Object.defineProperty(map, key, {
    value, writable: true, configurable: true, enumerable: false
  });
  const allowed = new Set(['demo:start', 'demo:next', 'demo:restart', 'demo:quit', 'playerAction', 'revealChoice']);
  socket.demoOnly = socket.handshake.query.demo === '1';
  socket.use(([event, payload, ack], next) => {
    const target = payload && (payload.table || payload.match2 || payload.tableID || payload.matchID);
    if ((socket.demoOnly && !allowed.has(event)) || (typeof target === 'string' && target.startsWith('demo:'))) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Action indisponible en démo.' });
      return;
    }
    next();
  });

  // Real (non-demo) rooms auto-deal the next hand a few seconds after a
  // showdown resolves. Demo rooms only ever advanced via the manual
  // "Nouvelle main" button, which looks exactly like a stuck game to anyone
  // just watching a demo play out. Mirror the real timing here by watching
  // for the same completion flags and replaying the existing demo:next flow
  // (start() below), instead of duplicating any poker/reveal logic.
  let autoNextPoll = null;
  let autoNextTimer = null;
  let autoNextArmedRound = null;

  function stopAutoNext() {
    if (autoNextPoll) { clearInterval(autoNextPoll); autoNextPoll = null; }
    if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
    autoNextArmedRound = null;
  }

  function armAutoNext(id) {
    autoNextPoll = setInterval(() => {
      const state = states[id];
      if (!state || socket.demoRoomID !== id) { stopAutoNext(); return; }
      if (state.gameFinished) { stopAutoNext(); return; }
      if (state.phase !== 'reveal' || !state.revealSeqDone || !state.roundEvaluated) return;
      if (autoNextArmedRound === state.roundNumber) return;
      autoNextArmedRound = state.roundNumber;
      clearInterval(autoNextPoll);
      autoNextPoll = null;
      autoNextTimer = setTimeout(() => {
        autoNextTimer = null;
        const current = states[id];
        if (!current || socket.demoRoomID !== id || current.gameFinished) return;
        const previous = JSON.parse(JSON.stringify(current));
        start(previous.players.length, previous);
      }, REVEAL_WINNER_MS);
    }, 350);
  }

  function dispose() {
    const id = socket.demoRoomID;
    if (!id) return;
    stopAutoNext();
    const state = states[id];
    engine.clear(id, state);
    socket.leave(id);
    state?.players.forEach(player => socket.leave(player.id));
    for (const map of [tables, matches, states, tableWaiting, matchWaiting]) delete map[id];
    socket.demoRoomID = null;
  }

  function start(seats, previous = null) {
    dispose();
    const id = `demo:${randomUUID()}`;
    const duel = seats === 2;
    const cfg = { demo: true, demoRoomID: id, mode: 'normal', level: 'Q0', totalSeats: seats, activeSeats: seats,
      players: Array.from({ length: seats }, (_, i) => `P${i + 1}`) };
    privateEntry(duel ? matches : tables, id, cfg);
    socket.demoOnly = true;
    socket.demoRoomID = id;
    socket.join(id);
    const waiting = cfg.players.map((label, i) => {
      const seatId = `${id}:seat:${i}`;
      socket.join(seatId);
      return { playerData: { id: seatId, label } };
    });
    if (previous) {
      previous.demoRoomID = id;
      previous.demoRevision = 0;
      previous.players.forEach((player, i) => { player.id = waiting[i].playerData.id; });
      privateEntry(states, id, previous);
      engine.next(id);
    } else {
      privateEntry(duel ? matchWaiting : tableWaiting, id, waiting);
      (duel ? engine.startMatch : engine.startTable)(id);
      privateEntry(states, id, states[id]);
    }
    armAutoNext(id);
    socket.emit('demo:ready', { roomID: id, seats });
  }

  socket.on('demo:start', (payload = {}, ack) => {
    if (![2, 10].includes(payload.seats) || (!socket.demoOnly && (socket.playerData || socket.rooms.size > 1))) {
      return ack?.({ ok: false, error: 'Ouvrez la démo depuis l’accueil.' });
    }
    if (!socket.demoRoomID) start(payload.seats);
    ack?.({ ok: true });
  });
  socket.on('demo:restart', (_payload, ack) => {
    const state = states[socket.demoRoomID];
    if (!state) return ack?.({ ok: false });
    start(state.players.length);
    ack?.({ ok: true });
  });
  socket.on('demo:next', (_payload, ack) => {
    const state = states[socket.demoRoomID];
    if (!state || state.gameFinished) return ack?.({ ok: false, error: 'Recommencez la partie pour rejouer.' });
    const previous = JSON.parse(JSON.stringify(state));
    // Abandoning an unfinished test hand refunds its committed chips. Completed
    // hands retain the engine's payouts. A new room retires pending runout jobs.
    if (!state.roundEvaluated) previous.players.forEach(player => {
      player.bankroll += player.total_bet_hand || 0;
    });
    start(previous.players.length, previous);
    ack?.({ ok: true });
  });
  socket.on('demo:quit', (_payload, ack) => { dispose(); ack?.({ ok: true }); });
  socket.on('disconnect', dispose);
}

module.exports = { registerDemoController };
