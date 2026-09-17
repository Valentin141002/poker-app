'use strict';

const { randomUUID } = require('node:crypto');

// Session/seat ownership only. Dealing, betting, evaluation and hand progression
// are supplied by the existing server engine.
function registerDemoController(socket, engine) {
  const { tables, matches, states, tableWaiting, matchWaiting } = engine;
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

  function dispose() {
    const id = socket.demoRoomID;
    if (!id) return;
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
    socket.emit('demo:ready', { roomID: id, seats });
  }

  function currentHand(payload, ack) {
    const state = states[socket.demoRoomID];
    if (!state || payload?.demoRoomID !== socket.demoRoomID || payload?.demoRound !== state.roundNumber) {
      ack?.({ ok: false, error: 'Cette main a déjà changé.', code: 'STALE_HAND' });
      return null;
    }
    return state;
  }

  socket.on('demo:start', (payload = {}, ack) => {
    if (![2, 10].includes(payload.seats) || (!socket.demoOnly && (socket.playerData || socket.rooms.size > 1))) {
      return ack?.({ ok: false, error: 'Ouvrez la démo depuis l’accueil.' });
    }
    if (!socket.demoRoomID) start(payload.seats);
    ack?.({ ok: true });
  });
  socket.on('demo:restart', (payload, ack) => {
    const state = currentHand(payload, ack);
    if (!state) return;
    start(state.players.length);
    ack?.({ ok: true });
  });
  socket.on('demo:next', (payload, ack) => {
    const state = currentHand(payload, ack);
    if (!state) return;
    if (state.gameFinished) return ack?.({ ok: false, error: 'Recommencez la partie pour rejouer.' });
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
